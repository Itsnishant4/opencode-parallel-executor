import { z } from "zod";
export declare const BatchExecuteArgsSchema: {
    concurrency: z.ZodDefault<z.ZodNumber>;
    commands: z.ZodOptional<z.ZodArray<z.ZodString>>;
    reads: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        path: z.ZodString;
        startLine: z.ZodOptional<z.ZodNumber>;
        endLine: z.ZodOptional<z.ZodNumber>;
        lines: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>]>>>;
    writes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        content: z.ZodString;
    }, z.core.$strip>>>;
    edits: z.ZodOptional<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        oldText: z.ZodString;
        newText: z.ZodString;
        replaceAll: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
    tasks: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        type: z.ZodEnum<{
            write: "write";
            command: "command";
            read: "read";
            edit: "edit";
        }>;
        command: z.ZodOptional<z.ZodString>;
        path: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
        oldText: z.ZodOptional<z.ZodString>;
        newText: z.ZodOptional<z.ZodString>;
        startLine: z.ZodOptional<z.ZodNumber>;
        endLine: z.ZodOptional<z.ZodNumber>;
        lines: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    failFast: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    timeoutMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
};
export interface BatchItemResult {
    index: number;
    id: string;
    type: "command" | "read" | "write" | "edit";
    target: string;
    status: "success" | "failed" | "skipped";
    durationMs: number;
    exitCode?: number;
    output: string;
    error?: string;
}
export declare class BatchExecutor {
    private rootDir;
    private cache;
    private bashRunner;
    constructor(rootDir?: string);
    runBatch(args: z.infer<z.ZodObject<typeof BatchExecuteArgsSchema>>, abortSignal?: AbortSignal, sessionDir?: string): Promise<string>;
    private formatReport;
}
//# sourceMappingURL=batch-tool.d.ts.map