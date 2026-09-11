import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { FastFileCache } from "./fast-cache.js";
import { FastBashRunner } from "./fast-bash.js";
import { OutputCompactor } from "./compact-output.js";
const hasBun = typeof Bun !== "undefined";
export const BatchExecuteArgsSchema = {
    concurrency: z
        .number()
        .int()
        .min(1)
        .max(30)
        .default(10)
        .describe("Max parallel execution lanes (e.g. 5, 10, 15). Defaults to 10."),
    commands: z
        .array(z.string())
        .optional()
        .describe("List of shell commands to execute simultaneously in parallel lanes"),
    reads: z
        .array(z.union([
        z.string(),
        z.object({
            path: z.string().describe("File path to read"),
            startLine: z.number().int().min(1).optional().describe("Start line"),
            endLine: z.number().int().min(1).optional().describe("End line"),
            lines: z.string().optional().describe("Range string, e.g. '1-60'"),
        }),
    ]))
        .optional()
        .describe("List of files or line ranges to read in parallel directly from RAM cache"),
    writes: z
        .array(z.object({
        path: z.string().describe("Target file path"),
        content: z.string().describe("File content to write"),
    }))
        .optional()
        .describe("List of files to write in parallel"),
    edits: z
        .array(z.object({
        path: z.string().describe("Target file path"),
        oldText: z.string().describe("Exact substring to replace"),
        newText: z.string().describe("Replacement string"),
        replaceAll: z.boolean().optional().describe("Replace all occurrences"),
    }))
        .optional()
        .describe("List of targeted file edits to execute in parallel"),
    tasks: z
        .array(z.object({
        id: z.string().optional(),
        type: z.enum(["command", "read", "write", "edit"]),
        command: z.string().optional(),
        path: z.string().optional(),
        content: z.string().optional(),
        oldText: z.string().optional(),
        newText: z.string().optional(),
        startLine: z.number().optional(),
        endLine: z.number().optional(),
        lines: z.string().optional(),
    }))
        .optional()
        .describe("Heterogeneous list of mixed tasks to execute concurrently with zero dependency waiting"),
    failFast: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, halts and cancels remaining queued tasks on the first failure"),
    timeoutMs: z
        .number()
        .int()
        .optional()
        .default(60000)
        .describe("Timeout per command in milliseconds"),
};
export class BatchExecutor {
    rootDir;
    cache = FastFileCache.getInstance();
    bashRunner;
    constructor(rootDir = process.cwd()) {
        this.rootDir = path.resolve(rootDir);
        this.bashRunner = new FastBashRunner(this.rootDir);
    }
    async runBatch(args, abortSignal, sessionDir) {
        const t0 = performance.now();
        const baseDir = sessionDir ? path.resolve(sessionDir) : this.rootDir;
        const concurrency = Math.max(1, Math.min(30, args.concurrency ?? 10));
        const failFast = args.failFast ?? false;
        const timeoutMs = args.timeoutMs ?? 60000;
        const taskQueue = [];
        let seq = 1;
        if (args.commands) {
            for (const cmd of args.commands) {
                taskQueue.push({
                    index: seq++,
                    id: `cmd-${seq - 1}`,
                    type: "command",
                    command: cmd,
                });
            }
        }
        if (args.reads) {
            for (const r of args.reads) {
                if (typeof r === "string") {
                    taskQueue.push({
                        index: seq++,
                        id: `read-${seq - 1}`,
                        type: "read",
                        path: r,
                    });
                }
                else {
                    taskQueue.push({
                        index: seq++,
                        id: `read-${seq - 1}`,
                        type: "read",
                        path: r.path,
                        startLine: r.startLine,
                        endLine: r.endLine,
                        lines: r.lines,
                    });
                }
            }
        }
        if (args.writes) {
            for (const w of args.writes) {
                taskQueue.push({
                    index: seq++,
                    id: `write-${seq - 1}`,
                    type: "write",
                    path: w.path,
                    content: w.content,
                });
            }
        }
        if (args.edits) {
            for (const e of args.edits) {
                taskQueue.push({
                    index: seq++,
                    id: `edit-${seq - 1}`,
                    type: "edit",
                    path: e.path,
                    oldText: e.oldText,
                    newText: e.newText,
                    replaceAll: e.replaceAll,
                });
            }
        }
        if (args.tasks) {
            for (const t of args.tasks) {
                taskQueue.push({
                    index: seq++,
                    id: t.id || `task-${seq - 1}`,
                    type: t.type,
                    command: t.command,
                    path: t.path,
                    content: t.content,
                    oldText: t.oldText,
                    newText: t.newText,
                    startLine: t.startLine,
                    endLine: t.endLine,
                    lines: t.lines,
                });
            }
        }
        if (taskQueue.length === 0) {
            return "⚠️ batch_execute: No tasks provided. Supply `commands`, `reads`, `writes`, `edits`, or `tasks`.";
        }
        // 2. High-concurrency worker dispatcher
        const results = new Array(taskQueue.length);
        let queueIdx = 0;
        let hasFailure = false;
        const executeItem = async (task) => {
            const itemStart = performance.now();
            const targetName = task.type === "command" ? (task.command || "") : (task.path || "");
            try {
                if (abortSignal?.aborted) {
                    return {
                        index: task.index,
                        id: task.id,
                        type: task.type,
                        target: targetName,
                        status: "skipped",
                        durationMs: 0,
                        output: "Aborted by client",
                    };
                }
                if (failFast && hasFailure) {
                    return {
                        index: task.index,
                        id: task.id,
                        type: task.type,
                        target: targetName,
                        status: "skipped",
                        durationMs: 0,
                        output: "Skipped due to prior failure (failFast: true)",
                    };
                }
                switch (task.type) {
                    case "command": {
                        const cmd = task.command || "";
                        const res = await this.bashRunner.execute(cmd, baseDir, timeoutMs, abortSignal);
                        const durationMs = Math.round(performance.now() - itemStart);
                        const compacted = OutputCompactor.compactCommand(cmd, res.stdout, res.stderr, res.exitCode);
                        if (res.exitCode !== 0) {
                            hasFailure = true;
                            return {
                                index: task.index,
                                id: task.id,
                                type: "command",
                                target: cmd,
                                status: "failed",
                                durationMs,
                                exitCode: res.exitCode,
                                output: compacted,
                                error: res.stderr || `Exited with code ${res.exitCode}`,
                            };
                        }
                        return {
                            index: task.index,
                            id: task.id,
                            type: "command",
                            target: cmd,
                            status: "success",
                            durationMs,
                            exitCode: 0,
                            output: compacted,
                        };
                    }
                    case "read": {
                        const relPath = task.path || "";
                        const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(baseDir, relPath);
                        let startLine = task.startLine;
                        let endLine = task.endLine;
                        if (task.lines) {
                            const m = task.lines.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
                            if (m) {
                                startLine = parseInt(m[1], 10);
                                endLine = parseInt(m[2], 10);
                            }
                        }
                        if (startLine !== undefined && endLine !== undefined) {
                            const lineRes = await this.cache.getLines(absPath, startLine, endLine, true);
                            const durationMs = Math.round(performance.now() - itemStart);
                            if (lineRes) {
                                return {
                                    index: task.index,
                                    id: task.id,
                                    type: "read",
                                    target: relPath,
                                    status: "success",
                                    durationMs,
                                    output: OutputCompactor.compactFile(lineRes.content),
                                };
                            }
                        }
                        const content = await this.cache.get(absPath);
                        const durationMs = Math.round(performance.now() - itemStart);
                        if (content !== null) {
                            return {
                                index: task.index,
                                id: task.id,
                                type: "read",
                                target: relPath,
                                status: "success",
                                durationMs,
                                output: OutputCompactor.compactFile(content),
                            };
                        }
                        hasFailure = true;
                        return {
                            index: task.index,
                            id: task.id,
                            type: "read",
                            target: relPath,
                            status: "failed",
                            durationMs,
                            output: `File not found: ${relPath}`,
                            error: `File not found: ${relPath}`,
                        };
                    }
                    case "write": {
                        const relPath = task.path || "";
                        const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(baseDir, relPath);
                        const content = task.content || "";
                        const dir = path.dirname(absPath);
                        await fs.mkdir(dir, { recursive: true });
                        if (hasBun) {
                            await Bun.write(absPath, content);
                        }
                        else {
                            await fs.writeFile(absPath, content, "utf-8");
                        }
                        this.cache.set(absPath, content);
                        const durationMs = Math.round(performance.now() - itemStart);
                        return {
                            index: task.index,
                            id: task.id,
                            type: "write",
                            target: relPath,
                            status: "success",
                            durationMs,
                            output: `Wrote ${content.length} characters`,
                        };
                    }
                    case "edit": {
                        const relPath = task.path || "";
                        const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(baseDir, relPath);
                        const oldStr = task.oldText || "";
                        const newStr = task.newText || "";
                        let content = await this.cache.get(absPath);
                        if (content === null) {
                            content = await fs.readFile(absPath, "utf-8");
                        }
                        if (!content.includes(oldStr)) {
                            hasFailure = true;
                            return {
                                index: task.index,
                                id: task.id,
                                type: "edit",
                                target: relPath,
                                status: "failed",
                                durationMs: Math.round(performance.now() - itemStart),
                                output: `Substring not found in ${relPath}`,
                                error: `Substring not found in ${relPath}`,
                            };
                        }
                        const updated = task.replaceAll
                            ? content.split(oldStr).join(newStr)
                            : content.replace(oldStr, () => newStr);
                        if (hasBun) {
                            await Bun.write(absPath, updated);
                        }
                        else {
                            await fs.writeFile(absPath, updated, "utf-8");
                        }
                        this.cache.set(absPath, updated);
                        const durationMs = Math.round(performance.now() - itemStart);
                        return {
                            index: task.index,
                            id: task.id,
                            type: "edit",
                            target: relPath,
                            status: "success",
                            durationMs,
                            output: `Replaced in ${relPath}`,
                        };
                    }
                }
            }
            catch (err) {
                hasFailure = true;
                return {
                    index: task.index,
                    id: task.id,
                    type: task.type,
                    target: targetName,
                    status: "failed",
                    durationMs: Math.round(performance.now() - itemStart),
                    output: err.message || String(err),
                    error: err.message || String(err),
                };
            }
        };
        // Run workers up to concurrency
        const workerCount = Math.min(concurrency, taskQueue.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (queueIdx < taskQueue.length) {
                if (abortSignal?.aborted)
                    break;
                if (failFast && hasFailure)
                    break;
                const current = taskQueue[queueIdx++];
                results[current.index - 1] = await executeItem(current);
            }
        });
        await Promise.all(workers);
        // Ensure any unexecuted tasks (due to failFast or abort) are recorded as skipped
        for (let i = 0; i < taskQueue.length; i++) {
            if (!results[i]) {
                const t = taskQueue[i];
                results[i] = {
                    index: t.index,
                    id: t.id,
                    type: t.type,
                    target: t.type === "command" ? (t.command || "") : (t.path || ""),
                    status: "skipped",
                    durationMs: 0,
                    output: abortSignal?.aborted ? "Aborted by client" : "Skipped due to prior failure (failFast: true)",
                };
            }
        }
        const totalDurationMs = Math.round(performance.now() - t0);
        const validResults = results.filter(Boolean);
        const succeeded = validResults.filter((r) => r.status === "success").length;
        const failed = validResults.filter((r) => r.status === "failed").length;
        const skipped = validResults.filter((r) => r.status === "skipped").length;
        // 3. Format compact output report
        return this.formatReport(validResults, concurrency, totalDurationMs, succeeded, failed, skipped);
    }
    formatReport(results, concurrency, totalDurationMs, succeeded, failed, skipped) {
        const lines = [];
        const icon = failed === 0 ? "⚡" : "⚠️";
        lines.push(`${icon} **batch_execute**: ${results.length} tasks completed in ${totalDurationMs}ms (${concurrency} parallel lanes) — ${succeeded} passed, ${failed} failed${skipped > 0 ? `, ${skipped} skipped` : ""}`);
        lines.push("");
        // Matrix Table
        lines.push("| # | Type | Target | Status | Time | Summary |");
        lines.push("| :-: | :--- | :--- | :--- | :--- | :--- |");
        for (const r of results) {
            const statusTag = r.status === "success" ? "✓ Pass" : r.status === "failed" ? "❌ Fail" : "⏭️ Skip";
            const targetClean = r.target.length > 40 ? r.target.slice(0, 37) + "..." : r.target;
            const singleLineOutput = r.output
                .replace(/\n+/g, " ")
                .replace(/[|`]/g, "")
                .trim();
            const outputSnippet = singleLineOutput.length > 50 ? singleLineOutput.slice(0, 47) + "..." : singleLineOutput;
            lines.push(`| ${r.index} | \`${r.type}\` | \`${targetClean}\` | ${statusTag} | ${r.durationMs}ms | ${outputSnippet || "(done)"} |`);
        }
        // Failure Details Block
        const failures = results.filter((r) => r.status === "failed");
        if (failures.length > 0) {
            lines.push("");
            lines.push("### ❌ Failure Details");
            for (const f of failures) {
                lines.push(`**Task #${f.index} (\`${f.type}\` \`${f.target}\`):**`);
                lines.push("```text");
                lines.push(f.output || f.error || "Unknown error");
                lines.push("```");
            }
        }
        // Detail Expanders for reads
        const fullReads = results.filter((r) => r.type === "read" && r.status === "success" && r.output.length > 0);
        if (fullReads.length > 0) {
            lines.push("");
            lines.push("### 📄 Read Outputs");
            for (const r of fullReads) {
                lines.push(`\n**[${r.target}]** (${r.durationMs}ms):`);
                const MAX_LEN = 8000;
                const text = r.output.length > MAX_LEN
                    ? r.output.slice(0, MAX_LEN) + `\n... [truncated, ${r.output.length - MAX_LEN} chars remaining] ...`
                    : r.output;
                lines.push("```");
                lines.push(text);
                lines.push("```");
            }
        }
        return lines.join("\n");
    }
}
//# sourceMappingURL=batch-tool.js.map