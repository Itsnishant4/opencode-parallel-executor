import { z } from "zod";
export declare const GitChangesArgsSchema: {
    path: z.ZodOptional<z.ZodString>;
    diff: z.ZodOptional<z.ZodBoolean>;
    staged: z.ZodOptional<z.ZodBoolean>;
    statOnly: z.ZodOptional<z.ZodBoolean>;
    maxDiffLines: z.ZodOptional<z.ZodNumber>;
};
export type GitChangesArgs = {
    path?: string;
    diff?: boolean;
    staged?: boolean;
    statOnly?: boolean;
    maxDiffLines?: number;
};
export interface GitFileStatus {
    path: string;
    statusCode: string;
    status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict" | "unknown";
    staged: boolean;
}
export interface GitChangesResult {
    isGitRepo: boolean;
    branch?: string;
    commit?: string;
    summary: {
        totalChanged: number;
        modified: number;
        added: number;
        deleted: number;
        untracked: number;
        renamed: number;
        stagedCount: number;
    };
    files: GitFileStatus[];
    stat?: string;
    diff?: string;
    diffTruncated?: boolean;
    durationMs: number;
}
export declare class GitChangesInspector {
    private defaultRootDir;
    constructor(defaultRootDir?: string);
    private resolveRepoDir;
    private parseStatusCode;
    inspect(args?: GitChangesArgs, abortSignal?: AbortSignal): Promise<GitChangesResult>;
}
//# sourceMappingURL=git-changes.d.ts.map