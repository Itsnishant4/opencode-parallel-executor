import { z } from "zod";
// Schema for read operations
export const ReadOperationSchema = z.union([
    z.string().describe("File path to read"),
    z.object({
        path: z.string().describe("Path of the file to read"),
        startLine: z.number().int().min(1).optional().describe("Starting line number to read (1-indexed, inclusive, e.g. 1)"),
        endLine: z.number().int().min(1).optional().describe("Ending line number to read (1-indexed, inclusive, e.g. 60)"),
        lines: z.string().optional().describe("Line range string, e.g. '1-60' or '10:50'"),
        offset: z.number().int().min(0).optional().describe("Optional starting line offset (0-indexed)"),
        length: z.number().int().min(1).optional().describe("Optional number of lines to read"),
        withLineNumbers: z.boolean().optional().describe("Whether to prefix output lines with line numbers (defaults to true for ranged reads)"),
        id: z.string().optional().describe("Unique identifier for this operation in DAG"),
        dependsOn: z.array(z.string()).optional().describe("Task IDs that must complete before this read executes"),
    }),
]);
// Schema for write operations
export const WriteOperationSchema = z.object({
    path: z.string().describe("File path to write to"),
    content: z.string().describe("Content to write into the file"),
    encoding: z.string().optional().describe("File encoding (default: utf-8)"),
    id: z.string().optional().describe("Unique identifier for this operation in DAG"),
    dependsOn: z.array(z.string()).optional().describe("Task IDs that must complete before this write executes"),
});
// Schema for edit operations
export const EditOperationSchema = z.object({
    path: z.string().describe("File path to edit"),
    oldText: z.string().describe("Existing exact substring to replace"),
    newText: z.string().describe("Replacement text"),
    replaceAll: z.boolean().optional().describe("Whether to replace all occurrences or just the first"),
    id: z.string().optional().describe("Unique identifier for this operation in DAG"),
    dependsOn: z.array(z.string()).optional().describe("Task IDs that must complete before this edit executes"),
});
// Schema for command execution operations
export const CommandOperationSchema = z.union([
    z.string().describe("Shell command to run"),
    z.object({
        command: z.string().describe("Shell command to run"),
        cwd: z.string().optional().describe("Working directory for command execution"),
        timeoutMs: z.number().int().min(100).optional().describe("Timeout in milliseconds for this command"),
        continueOnError: z.boolean().optional().describe("Whether the batch continues if this command fails"),
        id: z.string().optional().describe("Unique identifier for this operation in DAG"),
        dependsOn: z.array(z.string()).optional().describe("Task IDs that must complete before this command executes"),
    }),
]);
// Global execution options schema
export const ExecutionOptionsSchema = z.object({
    maxFileConcurrency: z.number().int().min(1).max(50).optional().describe("Maximum concurrent file I/O operations"),
    maxCommandConcurrency: z.number().int().min(1).max(20).optional().describe("Maximum concurrent shell commands"),
    timeoutMs: z.number().int().min(1000).optional().describe("Default timeout per command in milliseconds"),
    rollbackOnError: z.boolean().optional().describe("If true, restores files to original state on any mutation failure"),
    dryRun: z.boolean().optional().describe("If true, simulates execution and validates the plan without touching disk or running processes"),
});
// Unified parallel_execute tool args schema
export const ParallelExecuteArgsSchema = {
    reads: z.array(ReadOperationSchema).optional().describe("List of file paths or read specs to execute concurrently"),
    writes: z.array(WriteOperationSchema).optional().describe("List of files to write (created or overwritten)"),
    edits: z.array(EditOperationSchema).optional().describe("List of targeted file edits/replacements"),
    commands: z.array(CommandOperationSchema).optional().describe("List of terminal commands to execute"),
    options: ExecutionOptionsSchema.optional().describe("Execution and concurrency tuning options"),
};
//# sourceMappingURL=types.js.map