import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { FastFileCache } from "./fast-cache.js";
import { FastSearch } from "./fast-search.js";
export class FastWatcher {
    static instance;
    rootDir;
    watcher = null;
    cache = FastFileCache.getInstance();
    searcher;
    isPrewarming = false;
    prewarmedCount = 0;
    maxFileSize = 100 * 1024; // 100 KB limit for auto pre-warming
    constructor(rootDir = process.cwd()) {
        this.rootDir = path.resolve(rootDir);
        this.searcher = new FastSearch(this.rootDir);
    }
    static getInstance(rootDir) {
        if (!FastWatcher.instance) {
            FastWatcher.instance = new FastWatcher(rootDir);
        }
        return FastWatcher.instance;
    }
    /**
     * Starts background RAM pre-warming and native filesystem event listening.
     * Completely non-blocking.
     */
    start() {
        if (this.watcher)
            return;
        this.setupWatcher();
        if (this.watcher) {
            this.cache.setWatching(true);
        }
        // Start background pre-warming without blocking caller
        this.prewarmWorkspace().catch(() => {
            // Non-fatal prewarm error
        });
    }
    setupWatcher() {
        try {
            this.watcher = watch(this.rootDir, { recursive: true }, (_eventType, filename) => {
                if (!filename)
                    return;
                // Skip ignored paths
                const base = path.basename(filename);
                if (filename.includes("node_modules") ||
                    filename.includes(".git") ||
                    base === ".DS_Store" ||
                    base.startsWith("._")) {
                    return;
                }
                const fullPath = path.resolve(this.rootDir, filename);
                // Invalidate cache entry immediately
                this.cache.invalidate(fullPath);
                // Proactively reload modified file if it exists and is under maxFileSize
                fs.stat(fullPath)
                    .then((stats) => {
                    if (stats.isFile() && stats.size <= this.maxFileSize) {
                        return this.cache.get(fullPath);
                    }
                })
                    .catch(() => {
                    // File deleted or inaccessible
                });
            });
            this.watcher.on("error", (_err) => {
                // Safe graceful degradation: detach watcher on error so process does not crash
                this.stop();
            });
        }
        catch {
            // Fallback if recursive watch not supported
            this.watcher = null;
        }
    }
    async prewarmWorkspace() {
        if (this.isPrewarming)
            return;
        this.isPrewarming = true;
        try {
            const globResult = await this.searcher.glob(undefined, this.rootDir, 500);
            const files = globResult.matches;
            // Concurrently warm up files in chunks of 20
            const chunkSize = 20;
            for (let i = 0; i < files.length; i += chunkSize) {
                const chunk = files.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (relFile) => {
                    const fullPath = path.resolve(this.rootDir, relFile);
                    try {
                        const stats = await fs.stat(fullPath);
                        if (stats.isFile() && stats.size <= this.maxFileSize) {
                            await this.cache.get(fullPath);
                            this.prewarmedCount++;
                        }
                    }
                    catch { }
                }));
            }
        }
        finally {
            this.isPrewarming = false;
        }
    }
    getStatus() {
        return {
            isWatching: this.watcher !== null,
            prewarmedCount: this.prewarmedCount,
        };
    }
    stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.cache.setWatching(false);
    }
}
//# sourceMappingURL=fast-watcher.js.map