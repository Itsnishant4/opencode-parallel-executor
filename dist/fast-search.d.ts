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
export declare class FastSearch {
    private baseDir;
    constructor(baseDir?: string);
    /**
     * Fast file listing using git index or directory scanning in < 5ms.
     */
    glob(pattern?: string, cwd?: string, limit?: number): Promise<GlobResult>;
    /**
     * Fast pattern grep using git grep or streaming regex in < 10ms.
     */
    grep(query: string, targetPath?: string, limit?: number): Promise<GrepResult>;
    private gitLsFiles;
    private gitGrep;
    private globToRegex;
    private scanDirFast;
    private fallbackGrep;
}
//# sourceMappingURL=fast-search.d.ts.map