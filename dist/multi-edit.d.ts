import { z } from "zod";
export declare const MultiEditItemSchema: z.ZodObject<{
    path: z.ZodString;
    oldText: z.ZodString;
    newText: z.ZodString;
    replaceAll: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const MultiEditArgsSchema: {
    edits: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        oldText: z.ZodString;
        newText: z.ZodString;
        replaceAll: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    dryRun: z.ZodOptional<z.ZodBoolean>;
};
export interface MultiEditChangeSummary {
    path: string;
    replacements: number;
    oldSnippet: string;
    newSnippet: string;
}
export declare class MultiFileEditor {
    private baseDir;
    private cache;
    constructor(baseDir?: string);
    /**
     * Applies multiple edits across one or more files in an atomic 2-phase transaction.
     * If any single edit cannot be applied (e.g. oldText not found), NO files are touched.
     */
    executeMultiEdit(args: {
        edits: Array<{
            path: string;
            oldText: string;
            newText: string;
            replaceAll?: boolean;
        }>;
        dryRun?: boolean;
    }, sessionDir?: string): Promise<string>;
}
//# sourceMappingURL=multi-edit.d.ts.map