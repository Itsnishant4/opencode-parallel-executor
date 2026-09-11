import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { FastFileCache } from "./fast-cache.js";
import { FastBashRunner } from "./fast-bash.js";
import { OutputCompactor } from "./compact-output.js";
const hasBun = typeof Bun !== "undefined";
export class TaskExecutor {
    baseDir;
    options;
    abortSignal;
    backups = new Map();
    static knownDirs = new Set();
    fileCache = FastFileCache.getInstance();
    bashRunner;
    constructor(baseDir, options = {}, abortSignal) {
        this.baseDir = baseDir;
        this.options = {
            maxFileConcurrency: options.maxFileConcurrency ?? 10,
            maxCommandConcurrency: options.maxCommandConcurrency ?? 4,
            timeoutMs: options.timeoutMs ?? 60000,
            rollbackOnError: options.rollbackOnError ?? false,
            dryRun: options.dryRun ?? false,
        };
        this.abortSignal = abortSignal;
        this.bashRunner = new FastBashRunner(this.baseDir);
    }
    resolvePath(filePath) {
        if (path.isAbsolute(filePath))
            return filePath;
        return path.resolve(this.baseDir, filePath);
    }
    /**
     * Snapshot file before mutation for rollback safety
     */
    async snapshotFile(targetPath) {
        const resolved = this.resolvePath(targetPath);
        if (this.backups.has(resolved))
            return;
        try {
            let content = await this.fileCache.get(resolved);
            if (content === null) {
                if (hasBun) {
                    content = await Bun.file(resolved).text();
                }
                else {
                    content = await fs.readFile(resolved, "utf-8");
                }
            }
            this.backups.set(resolved, { path: resolved, existed: true, content });
        }
        catch (err) {
            if (err.code === "ENOENT") {
                this.backups.set(resolved, { path: resolved, existed: false });
            }
            else {
                this.backups.set(resolved, { path: resolved, existed: true });
            }
        }
    }
    /**
     * Revert all mutated files if rollback is triggered
     */
    async rollback() {
        for (const [filePath, backup] of this.backups.entries()) {
            try {
                if (!backup.existed) {
                    try {
                        await fs.unlink(filePath);
                        this.fileCache.invalidate(filePath);
                    }
                    catch { }
                }
                else if (backup.content !== undefined) {
                    if (hasBun) {
                        await Bun.write(filePath, backup.content);
                    }
                    else {
                        await fs.writeFile(filePath, backup.content, "utf-8");
                    }
                    this.fileCache.set(filePath, backup.content);
                }
            }
            catch (err) {
                console.error(`Failed to rollback file: ${filePath}`, err);
            }
        }
    }
    checkAborted() {
        if (this.abortSignal?.aborted) {
            throw new Error("Execution was aborted by the client.");
        }
    }
    /**
     * High-performance stream reader with early termination for line-ranges
     */
    async readLinesStream(resolvedPath, startLine, endLine, showLineNumbers) {
        return new Promise((resolve, reject) => {
            const stream = createReadStream(resolvedPath, { encoding: "utf-8" });
            const rl = readline.createInterface({
                input: stream,
                crlfDelay: Infinity,
            });
            const selectedLines = [];
            let currentLine = 0;
            let isAborted = false;
            const abortHandler = () => {
                isAborted = true;
                rl.close();
                stream.destroy();
                reject(new Error("Read aborted by client."));
            };
            if (this.abortSignal) {
                this.abortSignal.addEventListener("abort", abortHandler, { once: true });
            }
            rl.on("line", (line) => {
                currentLine++;
                if (currentLine >= startLine && currentLine <= endLine) {
                    selectedLines.push(line);
                }
                if (currentLine >= endLine) {
                    // Early termination
                    rl.close();
                    stream.destroy();
                }
            });
            rl.on("close", () => {
                if (this.abortSignal) {
                    this.abortSignal.removeEventListener("abort", abortHandler);
                }
                if (isAborted)
                    return;
                const padWidth = Math.max(2, String(endLine).length);
                let formatted;
                if (showLineNumbers) {
                    formatted = selectedLines
                        .map((line, idx) => `${String(startLine + idx).padStart(padWidth, " ")}: ${line}`)
                        .join("\n");
                }
                else {
                    formatted = selectedLines.join("\n");
                }
                resolve({
                    content: formatted,
                    linesRead: selectedLines.length,
                });
            });
            rl.on("error", (err) => {
                if (this.abortSignal) {
                    this.abortSignal.removeEventListener("abort", abortHandler);
                }
                stream.destroy();
                reject(err);
            });
        });
    }
    async executeRead(op) {
        const startTime = Date.now();
        const resolvedPath = this.resolvePath(op.path);
        if (this.options.dryRun) {
            return {
                id: op.id,
                type: "read",
                target: op.path,
                status: "success",
                durationMs: 0,
                output: `[DRY-RUN] Would read file: ${op.path}`,
            };
        }
        try {
            this.checkAborted();
            let startLine = op.startLine;
            let endLine = op.endLine;
            if (op.lines) {
                const match = op.lines.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
                if (match) {
                    startLine = parseInt(match[1], 10);
                    endLine = parseInt(match[2], 10);
                }
            }
            if (startLine === undefined && endLine === undefined && (op.offset !== undefined || op.length !== undefined)) {
                const offset = op.offset ?? 0;
                startLine = offset + 1;
                endLine = op.length !== undefined ? offset + op.length : undefined;
            }
            let outputText;
            let totalChars = 0;
            let lineMeta = {};
            if (startLine !== undefined && endLine !== undefined) {
                const showLineNumbers = op.withLineNumbers ?? true;
                // Check in-memory LRU cache first (< 0.1ms)
                const cached = await this.fileCache.getLines(resolvedPath, startLine, endLine, showLineNumbers);
                if (cached) {
                    outputText = cached.content;
                    totalChars = outputText.length;
                    lineMeta = { startLine, endLine, linesRead: cached.linesRead, cached: true };
                }
                else {
                    // Fallback to streaming reader with early abort
                    const { content: linesContent, linesRead } = await this.readLinesStream(resolvedPath, startLine, endLine, showLineNumbers);
                    outputText = `// Lines ${startLine}-${endLine} (${op.path})\n${linesContent}`;
                    totalChars = outputText.length;
                    lineMeta = { startLine, endLine, linesRead };
                }
            }
            else {
                // Full file read: Check in-memory cache first
                let content = await this.fileCache.get(resolvedPath);
                if (content === null) {
                    if (hasBun) {
                        content = await Bun.file(resolvedPath).text();
                    }
                    else {
                        content = await fs.readFile(resolvedPath, "utf-8");
                    }
                    this.fileCache.set(resolvedPath, content);
                }
                totalChars = content.length;
                const MAX_PREVIEW = 1024 * 100;
                if (content.length > MAX_PREVIEW) {
                    outputText =
                        content.slice(0, MAX_PREVIEW) +
                            `\n... [Content truncated, total length: ${content.length} chars]`;
                }
                else {
                    outputText = content;
                }
            }
            outputText = OutputCompactor.compactFile(outputText);
            return {
                id: op.id,
                type: "read",
                target: op.path,
                status: "success",
                durationMs: Date.now() - startTime,
                output: outputText,
                metadata: {
                    totalChars,
                    ...lineMeta,
                },
            };
        }
        catch (err) {
            const msg = err.code === "ENOENT" ? `File not found: ${op.path}` : err.message || String(err);
            return {
                id: op.id,
                type: "read",
                target: op.path,
                status: "failed",
                durationMs: Date.now() - startTime,
                error: msg,
            };
        }
    }
    async executeWrite(op) {
        const startTime = Date.now();
        const resolvedPath = this.resolvePath(op.path);
        if (this.options.dryRun) {
            return {
                id: op.id,
                type: "write",
                target: op.path,
                status: "success",
                durationMs: 0,
                output: `[DRY-RUN] Would write ${op.content.length} characters to ${op.path}`,
            };
        }
        try {
            this.checkAborted();
            await this.snapshotFile(resolvedPath);
            // Cached directory creation
            const dir = path.dirname(resolvedPath);
            if (!TaskExecutor.knownDirs.has(dir)) {
                await fs.mkdir(dir, { recursive: true });
                TaskExecutor.knownDirs.add(dir);
            }
            if (hasBun) {
                await Bun.write(resolvedPath, op.content);
            }
            else {
                await fs.writeFile(resolvedPath, op.content, op.encoding || "utf-8");
            }
            // Update in-memory cache
            this.fileCache.set(resolvedPath, op.content);
            return {
                id: op.id,
                type: "write",
                target: op.path,
                status: "success",
                durationMs: Date.now() - startTime,
                output: `Wrote ${op.content.length} characters to ${op.path}`,
                metadata: { bytesWritten: Buffer.byteLength(op.content) },
            };
        }
        catch (err) {
            return {
                id: op.id,
                type: "write",
                target: op.path,
                status: "failed",
                durationMs: Date.now() - startTime,
                error: err.message || String(err),
            };
        }
    }
    async executeEdit(op) {
        const startTime = Date.now();
        const resolvedPath = this.resolvePath(op.path);
        if (this.options.dryRun) {
            return {
                id: op.id,
                type: "edit",
                target: op.path,
                status: "success",
                durationMs: 0,
                output: `[DRY-RUN] Would replace "${op.oldText.slice(0, 40)}..." in ${op.path}`,
            };
        }
        try {
            this.checkAborted();
            await this.snapshotFile(resolvedPath);
            let content = await this.fileCache.get(resolvedPath);
            if (content === null) {
                if (hasBun) {
                    content = await Bun.file(resolvedPath).text();
                }
                else {
                    content = await fs.readFile(resolvedPath, "utf-8");
                }
            }
            if (!content.includes(op.oldText)) {
                throw new Error(`Target substring to replace was not found in ${op.path}. Ensure exact match.`);
            }
            let updated;
            let occurrences = 0;
            if (op.replaceAll) {
                const parts = content.split(op.oldText);
                occurrences = parts.length - 1;
                updated = parts.join(op.newText);
            }
            else {
                occurrences = 1;
                updated = content.replace(op.oldText, () => op.newText);
            }
            if (hasBun) {
                await Bun.write(resolvedPath, updated);
            }
            else {
                await fs.writeFile(resolvedPath, updated, "utf-8");
            }
            // Update in-memory cache
            this.fileCache.set(resolvedPath, updated);
            return {
                id: op.id,
                type: "edit",
                target: op.path,
                status: "success",
                durationMs: Date.now() - startTime,
                output: `Replaced ${occurrences} occurrence(s) in ${op.path}`,
                metadata: { occurrences },
            };
        }
        catch (err) {
            const msg = err.code === "ENOENT" ? `File not found for edit: ${op.path}` : err.message || String(err);
            return {
                id: op.id,
                type: "edit",
                target: op.path,
                status: "failed",
                durationMs: Date.now() - startTime,
                error: msg,
            };
        }
    }
    async executeCommand(op) {
        const timeoutMs = op.timeoutMs ?? this.options.timeoutMs;
        if (this.options.dryRun) {
            return {
                id: op.id,
                type: "command",
                target: op.command,
                status: "success",
                durationMs: 0,
                output: `[DRY-RUN] Would run command: "${op.command}"`,
            };
        }
        this.checkAborted();
        const res = await this.bashRunner.execute(op.command, op.cwd, timeoutMs, this.abortSignal);
        const compactedOutput = OutputCompactor.compactCommand(op.command, res.stdout, res.stderr, res.exitCode);
        if (res.exitCode === 0) {
            return {
                id: op.id,
                type: "command",
                target: op.command,
                status: "success",
                durationMs: res.durationMs,
                output: compactedOutput,
                metadata: { exitCode: 0, inProcess: res.inProcess },
            };
        }
        else {
            return {
                id: op.id,
                type: "command",
                target: op.command,
                status: "failed",
                durationMs: res.durationMs,
                output: compactedOutput,
                error: res.stderr || `Process exited with code ${res.exitCode}`,
                metadata: { exitCode: res.exitCode, inProcess: res.inProcess },
            };
        }
    }
    async executeTask(task) {
        switch (task.type) {
            case "read":
                return this.executeRead(task);
            case "write":
                return this.executeWrite(task);
            case "edit":
                return this.executeEdit(task);
            case "command":
                return this.executeCommand(task);
        }
    }
    /**
     * Continuous Dynamic DAG Execution:
     * Executes tasks as soon as their exact prerequisites finish with zero barrier latency.
     */
    async executeContinuousDAG(ops) {
        const overallStart = Date.now();
        const taskResults = new Map();
        const taskMap = new Map();
        const dependentsMap = new Map();
        const remainingDeps = new Map();
        for (const op of ops) {
            taskMap.set(op.id, op);
            remainingDeps.set(op.id, op.dependsOn.length);
            if (!dependentsMap.has(op.id))
                dependentsMap.set(op.id, []);
        }
        for (const op of ops) {
            for (const depId of op.dependsOn) {
                if (!dependentsMap.has(depId))
                    dependentsMap.set(depId, []);
                dependentsMap.get(depId).push(op.id);
            }
        }
        const readyQueue = [];
        for (const [id, count] of remainingDeps.entries()) {
            if (count === 0)
                readyQueue.push(id);
        }
        let activeFiles = 0;
        let activeCommands = 0;
        let halted = false;
        let rolledBack = false;
        // Concurrency dispatcher loop
        await new Promise((resolveComplete, rejectComplete) => {
            let activeWorkers = 0;
            const dispatch = () => {
                if (this.abortSignal?.aborted) {
                    rejectComplete(new Error("Execution aborted by client."));
                    return;
                }
                if (halted) {
                    for (const op of ops) {
                        if (!taskResults.has(op.id)) {
                            taskResults.set(op.id, {
                                id: op.id,
                                type: op.type,
                                target: op.type === "command" ? op.command : op.path,
                                status: "skipped",
                                durationMs: 0,
                                error: "Skipped due to prior failure",
                            });
                        }
                    }
                    if (activeWorkers === 0)
                        resolveComplete();
                    return;
                }
                if (taskResults.size === ops.length && activeWorkers === 0) {
                    resolveComplete();
                    return;
                }
                // Launch ready tasks honoring concurrency limits
                for (let i = 0; i < readyQueue.length; i++) {
                    const taskId = readyQueue[i];
                    const task = taskMap.get(taskId);
                    const isCmd = task.type === "command";
                    if (isCmd && activeCommands >= this.options.maxCommandConcurrency)
                        continue;
                    if (!isCmd && activeFiles >= this.options.maxFileConcurrency)
                        continue;
                    readyQueue.splice(i, 1);
                    i--;
                    if (isCmd)
                        activeCommands++;
                    else
                        activeFiles++;
                    activeWorkers++;
                    this.executeTask(task)
                        .then(async (result) => {
                        taskResults.set(taskId, result);
                        if (isCmd)
                            activeCommands--;
                        else
                            activeFiles--;
                        activeWorkers--;
                        const failed = result.status === "failed";
                        if (failed) {
                            const shouldHalt = this.options.rollbackOnError ||
                                task.type === "write" ||
                                task.type === "edit" ||
                                (isCmd && !task.continueOnError);
                            if (this.options.rollbackOnError && !rolledBack) {
                                await this.rollback();
                                rolledBack = true;
                            }
                            if (shouldHalt) {
                                halted = true;
                            }
                        }
                        if (!failed && !halted) {
                            const downstream = dependentsMap.get(taskId) || [];
                            for (const childId of downstream) {
                                const currentCount = (remainingDeps.get(childId) || 1) - 1;
                                remainingDeps.set(childId, currentCount);
                                if (currentCount === 0) {
                                    readyQueue.push(childId);
                                }
                            }
                        }
                        dispatch();
                    })
                        .catch(async (err) => {
                        if (isCmd)
                            activeCommands--;
                        else
                            activeFiles--;
                        activeWorkers--;
                        taskResults.set(taskId, {
                            id: taskId,
                            type: task.type,
                            target: task.type === "command" ? task.command : task.path,
                            status: "failed",
                            durationMs: 0,
                            error: err.message || String(err),
                        });
                        if (this.options.rollbackOnError && !rolledBack) {
                            await this.rollback();
                            rolledBack = true;
                        }
                        halted = true;
                        dispatch();
                    });
                }
                if (activeWorkers === 0 && readyQueue.length === 0 && taskResults.size < ops.length) {
                    halted = true;
                    dispatch();
                }
            };
            dispatch();
        });
        const resultsList = Array.from(taskResults.values());
        const reads = resultsList.filter((r) => r.type === "read");
        const mutations = resultsList.filter((r) => r.type === "write" || r.type === "edit");
        const commands = resultsList.filter((r) => r.type === "command");
        const stages = [];
        let stageIdx = 1;
        if (reads.length > 0) {
            stages.push({
                stageIndex: stageIdx++,
                stageName: "File Reads",
                isParallel: true,
                tasks: reads,
                durationMs: Math.max(0, ...reads.map((r) => r.durationMs)),
            });
        }
        if (mutations.length > 0) {
            stages.push({
                stageIndex: stageIdx++,
                stageName: "File Mutations (Writes & Edits)",
                isParallel: true,
                tasks: mutations,
                durationMs: Math.max(0, ...mutations.map((m) => m.durationMs)),
            });
        }
        if (commands.length > 0) {
            stages.push({
                stageIndex: stageIdx++,
                stageName: "Command Executions",
                isParallel: true,
                tasks: commands,
                durationMs: Math.max(0, ...commands.map((c) => c.durationMs)),
            });
        }
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;
        for (const r of resultsList) {
            if (r.status === "success")
                succeeded++;
            else if (r.status === "failed")
                failed++;
            else if (r.status === "skipped")
                skipped++;
        }
        return {
            summary: {
                total: resultsList.length,
                succeeded,
                failed,
                skipped,
                durationMs: Date.now() - overallStart,
                stagesExecuted: stages.length,
            },
            stages,
            rolledBack,
            dryRun: this.options.dryRun,
        };
    }
}
//# sourceMappingURL=executor.js.map