import fs from "node:fs/promises";
import path from "node:path";

declare const Bun: {
  file(path: string): { text(): Promise<string> };
  write(destination: string, data: string | Uint8Array): Promise<number>;
} | undefined;

const hasBun = typeof Bun !== "undefined";

interface CacheEntry {
  content: string;
  mtimeMs: number;
  lines?: string[];
  accessedAt: number;
}

export class FastFileCache {
  private static instance: FastFileCache;
  private cache: Map<string, CacheEntry> = new Map();
  private maxEntries: number = 1000;
  private isWatching: boolean = false;

  public static getInstance(): FastFileCache {
    if (!FastFileCache.instance) {
      FastFileCache.instance = new FastFileCache();
    }
    return FastFileCache.instance;
  }

  public setWatching(watching: boolean): void {
    this.isWatching = watching;
  }

  public getWatching(): boolean {
    return this.isWatching;
  }

  public has(filePath: string): boolean {
    return this.cache.has(this.normalize(filePath));
  }

  public getCachedSize(): number {
    return this.cache.size;
  }

  public getStats(): { size: number; isWatching: boolean; memoryBytes: number } {
    let memoryBytes = 0;
    for (const entry of this.cache.values()) {
      memoryBytes += (entry.content ? entry.content.length * 2 : 0);
    }
    return {
      size: this.cache.size,
      isWatching: this.isWatching,
      memoryBytes,
    };
  }

  private normalize(filePath: string): string {
    return path.resolve(filePath);
  }

  public async get(filePath: string): Promise<string | null> {
    const key = this.normalize(filePath);
    const entry = this.cache.get(key);

    // Instant RAM fast-path when directory watcher is active
    if (this.isWatching && entry) {
      entry.accessedAt = Date.now();
      return entry.content;
    }

    try {
      const stats = await fs.stat(key);
      if (entry && entry.mtimeMs === stats.mtimeMs) {
        entry.accessedAt = Date.now();
        return entry.content;
      }

      let content: string;
      if (hasBun) {
        content = await Bun.file(key).text();
      } else {
        content = await fs.readFile(key, "utf-8");
      }

      this.setWithMtime(key, content, stats.mtimeMs);
      return content;
    } catch {
      return null;
    }
  }

  public async getLines(
    filePath: string,
    startLine: number,
    endLine: number,
    showLineNumbers: boolean = true
  ): Promise<{ content: string; linesRead: number } | null> {
    const key = this.normalize(filePath);
    let entry = this.cache.get(key);

    if (!this.isWatching || !entry) {
      try {
        const stats = await fs.stat(key);
        if (!entry || entry.mtimeMs !== stats.mtimeMs) {
          let rawContent: string;
          if (hasBun) {
            rawContent = await Bun.file(key).text();
          } else {
            rawContent = await fs.readFile(key, "utf-8");
          }
          this.setWithMtime(key, rawContent, stats.mtimeMs);
          entry = this.cache.get(key)!;
        }
      } catch {
        return null;
      }
    }

    if (!entry) return null;

    entry.accessedAt = Date.now();

    if (!entry.lines) {
      entry.lines = entry.content.split("\n");
    }

    const allLines = entry.lines;
    const total = allLines.length;

    if (total === 0 || startLine > total) {
      return {
        content: `// Lines ${startLine}-${endLine} of ${total} (${filePath})\n(no lines in this range)`,
        linesRead: 0,
      };
    }

    const start = Math.max(1, startLine);
    const end = Math.min(total, Math.max(start, endLine));

    const selected = allLines.slice(start - 1, end);
    const padWidth = Math.max(2, String(end).length);

    let formatted: string;
    if (showLineNumbers) {
      formatted = selected
        .map((line, idx) => `${String(start + idx).padStart(padWidth, " ")}: ${line}`)
        .join("\n");
    } else {
      formatted = selected.join("\n");
    }

    return {
      content: `// Lines ${start}-${end} of ${total} (${filePath})\n${formatted}`,
      linesRead: selected.length,
    };
  }

  public set(filePath: string, content: string): void {
    const key = this.normalize(filePath);
    this.setWithMtime(key, content, Date.now());
  }

  private setWithMtime(key: string, content: string, mtimeMs: number): void {
    if (this.cache.size >= this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [k, v] of this.cache.entries()) {
        if (v.accessedAt < oldestTime) {
          oldestTime = v.accessedAt;
          oldestKey = k;
        }
      }

      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      content,
      mtimeMs,
      accessedAt: Date.now(),
    });
  }

  public invalidate(filePath: string): void {
    const key = this.normalize(filePath);
    this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }
}
