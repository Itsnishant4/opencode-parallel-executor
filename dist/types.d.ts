import { z } from "zod";
export declare const ReadOperationSchema: z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    path: z.ZodString;
    startLine: z.ZodOptional<z.ZodNumber>;
    endLine: z.ZodOptional<z.ZodNumber>;
    lines: z.ZodOptional<z.ZodString>;
    offset: z.ZodOptional<z.ZodNumber>;
    length: z.ZodOptional<z.ZodNumber>;
    withLineNumbers: z.ZodOptional<z.ZodBoolean>;
    id: z.ZodOptional<z.ZodString>;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>]>;
export type ReadOperationInput = z.infer<typeof ReadOperationSchema>;
export interface NormalizedReadOp {
    id: string;
    type: "read";
    path: string;
    startLine?: number;
    endLine?: number;
    lines?: string;
    offset?: number;
    length?: number;
    withLineNumbers?: boolean;
    dependsOn: string[];
}
export declare const WriteOperationSchema: z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
    encoding: z.ZodOptional<z.ZodString>;
    id: z.ZodOptional<z.ZodString>;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type WriteOperationInput = z.infer<typeof WriteOperationSchema>;
export interface NormalizedWriteOp {
    id: string;
    type: "write";
    path: string;
    content: string;
    encoding: string;
    dependsOn: string[];
}
export declare const EditOperationSchema: z.ZodObject<{
    path: z.ZodString;
    oldText: z.ZodString;
    newText: z.ZodString;
    replaceAll: z.ZodOptional<z.ZodBoolean>;
    id: z.ZodOptional<z.ZodString>;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type EditOperationInput = z.infer<typeof EditOperationSchema>;
export interface NormalizedEditOp {
    id: string;
    type: "edit";
    path: string;
    oldText: string;
    newText: string;
    replaceAll: boolean;
    dependsOn: string[];
}
export declare const CommandOperationSchema: z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    command: z.ZodString;
    cwd: z.ZodOptional<z.ZodString>;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
    continueOnError: z.ZodOptional<z.ZodBoolean>;
    id: z.ZodOptional<z.ZodString>;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>]>;
export type CommandOperationInput = z.infer<typeof CommandOperationSchema>;
export interface NormalizedCommandOp {
    id: string;
    type: "command";
    command: string;
    cwd?: string;
    timeoutMs?: number;
    continueOnError: boolean;
    dependsOn: string[];
}
export declare const ExecutionOptionsSchema: z.ZodObject<{
    maxFileConcurrency: z.ZodOptional<z.ZodNumber>;
    maxCommandConcurrency: z.ZodOptional<z.ZodNumber>;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
    rollbackOnError: z.ZodOptional<z.ZodBoolean>;
    dryRun: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export interface ExecutionOptions {
    maxFileConcurrency?: number;
    maxCommandConcurrency?: number;
    timeoutMs?: number;
    rollbackOnError?: boolean;
    dryRun?: boolean;
}
export declare const ParallelExecuteArgsSchema: {
    reads: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        path: z.ZodString;
        startLine: z.ZodOptional<z.ZodNumber>;
        endLine: z.ZodOptional<z.ZodNumber>;
        lines: z.ZodOptional<z.ZodString>;
        offset: z.ZodOptional<z.ZodNumber>;
        length: z.ZodOptional<z.ZodNumber>;
        withLineNumbers: z.ZodOptional<z.ZodBoolean>;
        id: z.ZodOptional<z.ZodString>;
        dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>]>>>;
    writes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        content: z.ZodString;
        encoding: z.ZodOptional<z.ZodString>;
        id: z.ZodOptional<z.ZodString>;
        dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>>;
    edits: z.ZodOptional<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        oldText: z.ZodString;
        newText: z.ZodString;
        replaceAll: z.ZodOptional<z.ZodBoolean>;
        id: z.ZodOptional<z.ZodString>;
        dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>>;
    commands: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        command: z.ZodString;
        cwd: z.ZodOptional<z.ZodString>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
        continueOnError: z.ZodOptional<z.ZodBoolean>;
        id: z.ZodOptional<z.ZodString>;
        dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>]>>>;
    options: z.ZodOptional<z.ZodObject<{
        maxFileConcurrency: z.ZodOptional<z.ZodNumber>;
        maxCommandConcurrency: z.ZodOptional<z.ZodNumber>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
        rollbackOnError: z.ZodOptional<z.ZodBoolean>;
        dryRun: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
};
export type NormalizedOp = NormalizedReadOp | NormalizedWriteOp | NormalizedEditOp | NormalizedCommandOp;
export interface TaskResult {
    id: string;
    type: "read" | "write" | "edit" | "command";
    target: string;
    status: "success" | "failed" | "skipped";
    durationMs: number;
    output?: string;
    error?: string;
    metadata?: Record<string, any>;
}
export interface StageExecutionResult {
    stageIndex: number;
    stageName: string;
    isParallel: boolean;
    tasks: TaskResult[];
    durationMs: number;
}
export interface ParallelExecuteResult {
    summary: {
        total: number;
        succeeded: number;
        failed: number;
        skipped: number;
        durationMs: number;
        stagesExecuted: number;
    };
    stages: StageExecutionResult[];
    rolledBack: boolean;
    dryRun: boolean;
}
//# sourceMappingURL=types.d.ts.map