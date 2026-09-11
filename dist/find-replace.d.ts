import { z } from "zod";
export declare const FindReplaceArgsSchema: {
    find: z.ZodString;
    replace: z.ZodString;
    isRegex: z.ZodOptional<z.ZodBoolean>;
    regexFlags: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    path: z.ZodOptional<z.ZodString>;
    dryRun: z.ZodOptional<z.ZodBoolean>;
    maxFiles: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
};
export interface FileReplacementSummary {
    file: string;
    matches: number;
}
export declare class FindReplaceEngine {
    private baseDir;
    private cache;
    private searcher;
    constructor(baseDir?: string);
    executeFindReplace(args: {
        find: string;
        replace: string;
        isRegex?: boolean;
        regexFlags?: string;
        path?: string;
        dryRun?: boolean;
        maxFiles?: number;
    }, sessionDir?: string): Promise<string>;
}
//# sourceMappingURL=find-replace.d.ts.map