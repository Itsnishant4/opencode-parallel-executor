import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

export interface GlobResult {
  matches: string[];
  durationMs: number;
  totalFound: number;
}

export interface GrepResult {
  matches: Array<{
    file: string;
    line: number;
    content: string;
  }>;
  durationMs: number;
  totalMatches: number;
}

export class FastSearch {
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
  }

  /**
   * Fast file listing using git index or directory scanning in < 5ms.
   */
  public async glob(
    pattern?: string,
    cwd?: string,
    limit: number = 100
  ): Promise<GlobResult> {
    const t0 = Date.now();
    const effectiveCwd = cwd ? path.resolve(this.baseDir, cwd) : this.baseDir;

    // 1. Try git ls-files fast-path
    try {
      const gitFiles = await this.gitLsFiles(effectiveCwd);
      let filtered = gitFiles;

      if (pattern && pattern !== "*" && pattern !== "**/*") {
        const regex = this.globToRegex(pattern);
        filtered = gitFiles.filter((f) => regex.test(f));
      }

      const sliced = filtered.slice(0, limit);
      return {
        matches: sliced,
        durationMs: Date.now() - t0,
        totalFound: filtered.length,
      };
    } catch {
      // Fallback to fast directory scan
      const matches = await this.scanDirFast(effectiveCwd, pattern, limit);
      return {
        matches,
        durationMs: Date.now() - t0,
        totalFound: matches.length,
      };
    }
  }

  /**
   * Fast pattern grep using git grep or streaming regex in < 10ms.
   */
  public async grep(
    query: string,
    targetPath?: string,
    limit: number = 100
  ): Promise<GrepResult> {
    const t0 = Date.now();
    const searchRoot = targetPath
      ? path.resolve(this.baseDir, targetPath)
      : this.baseDir;

    // 1. Try git grep fast-path
    try {
      const results = await this.gitGrep(query, searchRoot, limit);
      return {
        matches: results,
        durationMs: Date.now() - t0,
        totalMatches: results.length,
      };
    } catch {
      // Fallback
      const results = await this.fallbackGrep(query, searchRoot, limit);
      return {
        matches: results,
        durationMs: Date.now() - t0,
        totalMatches: results.length,
      };
    }
  }

  private gitLsFiles(cwd: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard"],
        { cwd }
      );
      const chunks: Buffer[] = [];

      proc.stdout.on("data", (c) => chunks.push(c));
      proc.on("close", (code) => {
        if (code === 0) {
          const text = Buffer.concat(chunks).toString("utf-8");
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          resolve(lines);
        } else {
          reject(new Error("Not a git repository"));
        }
      });
      proc.on("error", reject);
    });
  }

  private gitGrep(
    query: string,
    cwd: string,
    limit: number
  ): Promise<Array<{ file: string; line: number; content: string }>> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        "git",
        ["grep", "--untracked", "-n", "-I", "--", query],
        { cwd }
      );
      const chunks: Buffer[] = [];

      proc.stdout.on("data", (c) => chunks.push(c));
      proc.on("close", (code) => {
        if (code === 0 || code === 1) {
          const text = Buffer.concat(chunks).toString("utf-8");
          const lines = text.split("\n").filter(Boolean);
          const results: Array<{ file: string; line: number; content: string }> = [];

          for (const line of lines) {
            if (results.length >= limit) break;
            const parts = line.split(":");
            if (parts.length >= 3) {
              const file = parts[0];
              const lineNum = parseInt(parts[1], 10);
              const content = parts.slice(2).join(":");
              results.push({ file, line: lineNum, content });
            }
          }
          resolve(results);
        } else {
          reject(new Error("Git grep failed"));
        }
      });
      proc.on("error", reject);
    });
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`);
  }

  private async scanDirFast(
    dir: string,
    pattern?: string,
    limit: number = 100
  ): Promise<string[]> {
    const results: string[] = [];
    const regex = pattern ? this.globToRegex(pattern) : null;
    const ignored = new Set(["node_modules", ".git", "dist", ".next", "build", "coverage"]);

    async function walk(currentDir: string, relPrefix: string) {
      if (results.length >= limit) return;
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (ignored.has(entry.name)) continue;
          const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await walk(path.join(currentDir, entry.name), relPath);
          } else if (entry.isFile()) {
            if (!regex || regex.test(relPath)) {
              results.push(relPath);
              if (results.length >= limit) return;
            }
          }
        }
      } catch {}
    }

    await walk(dir, "");
    return results;
  }

  private async fallbackGrep(
    query: string,
    root: string,
    limit: number
  ): Promise<Array<{ file: string; line: number; content: string }>> {
    const files = await this.scanDirFast(root, undefined, 200);
    const results: Array<{ file: string; line: number; content: string }> = [];

    for (const file of files) {
      if (results.length >= limit) break;
      try {
        const content = await fs.readFile(path.join(root, file), "utf-8");
        if (!content.includes(query)) continue;

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            results.push({ file, line: i + 1, content: lines[i] });
            if (results.length >= limit) break;
          }
        }
      } catch {}
    }

    return results;
  }
}
