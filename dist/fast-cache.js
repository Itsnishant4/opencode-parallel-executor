import fs from "node:fs/promises";
import path from "node:path";
const hasBun = typeof Bun !== "undefined";
export class FastFileCache {
    static instance;
    cache = new Map();
    maxEntries = 1000;
    isWatching = false;
    static getInstance() {
        if (!FastFileCache.instance) {
            FastFileCache.instance = new FastFileCache();
        }
        return FastFileCache.instance;
    }
    setWatching(watching) {
        this.isWatching = watching;
    }
    getWatching() {
        return this.isWatching;
    }
    has(filePath) {
        return this.cache.has(this.normalize(filePath));
    }
    getCachedSize() {
        return this.cache.size;
    }
    normalize(filePath) {
        return path.resolve(filePath);
    }
    async get(filePath) {
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
            let content;
            if (hasBun) {
                content = await Bun.file(key).text();
            }
            else {
                content = await fs.readFile(key, "utf-8");
            }
            this.setWithMtime(key, content, stats.mtimeMs);
            return content;
        }
        catch {
            return null;
        }
    }
    async getLines(filePath, startLine, endLine, showLineNumbers = true) {
        const key = this.normalize(filePath);
        let entry = this.cache.get(key);
        if (!this.isWatching || !entry) {
            try {
                const stats = await fs.stat(key);
                if (!entry || entry.mtimeMs !== stats.mtimeMs) {
                    let rawContent;
                    if (hasBun) {
                        rawContent = await Bun.file(key).text();
                    }
                    else {
                        rawContent = await fs.readFile(key, "utf-8");
                    }
                    this.setWithMtime(key, rawContent, stats.mtimeMs);
                    entry = this.cache.get(key);
                }
            }
            catch {
                return null;
            }
        }
        if (!entry)
            return null;
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
        let formatted;
        if (showLineNumbers) {
            formatted = selected
                .map((line, idx) => `${String(start + idx).padStart(padWidth, " ")}: ${line}`)
                .join("\n");
        }
        else {
            formatted = selected.join("\n");
        }
        return {
            content: `// Lines ${start}-${end} of ${total} (${filePath})\n${formatted}`,
            linesRead: selected.length,
        };
    }
    set(filePath, content) {
        const key = this.normalize(filePath);
        this.setWithMtime(key, content, Date.now());
    }
    setWithMtime(key, content, mtimeMs) {
        if (this.cache.size >= this.maxEntries) {
            let oldestKey = null;
            let oldestTime = Infinity;
            for (const [k, v] of this.cache.entries()) {
                if (v.accessedAt < oldestTime) {
                    oldestTime = v.accessedAt;
                    oldestKey = k;
                }
            }
            if (oldestKey)
                this.cache.delete(oldestKey);
        }
        this.cache.set(key, {
            content,
            mtimeMs,
            accessedAt: Date.now(),
        });
    }
    invalidate(filePath) {
        const key = this.normalize(filePath);
        this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
    }
}
//# sourceMappingURL=fast-cache.js.map