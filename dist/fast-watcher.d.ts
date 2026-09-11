export declare class FastWatcher {
    private static instance;
    private rootDir;
    private watcher;
    private cache;
    private searcher;
    private isPrewarming;
    private prewarmedCount;
    private maxFileSize;
    constructor(rootDir?: string);
    static getInstance(rootDir?: string): FastWatcher;
    /**
     * Starts background RAM pre-warming and native filesystem event listening.
     * Completely non-blocking.
     */
    start(): void;
    private setupWatcher;
    private prewarmWorkspace;
    getStatus(): {
        isWatching: boolean;
        prewarmedCount: number;
    };
    stop(): void;
}
//# sourceMappingURL=fast-watcher.d.ts.map