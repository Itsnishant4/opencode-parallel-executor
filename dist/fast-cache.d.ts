export declare class FastFileCache {
    private static instance;
    private cache;
    private maxEntries;
    private isWatching;
    static getInstance(): FastFileCache;
    setWatching(watching: boolean): void;
    getWatching(): boolean;
    has(filePath: string): boolean;
    getCachedSize(): number;
    getStats(): {
        size: number;
        isWatching: boolean;
        memoryBytes: number;
    };
    private normalize;
    get(filePath: string): Promise<string | null>;
    getLines(filePath: string, startLine: number, endLine: number, showLineNumbers?: boolean): Promise<{
        content: string;
        linesRead: number;
    } | null>;
    set(filePath: string, content: string): void;
    private setWithMtime;
    invalidate(filePath: string): void;
    clear(): void;
}
//# sourceMappingURL=fast-cache.d.ts.map