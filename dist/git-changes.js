import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
const execFileAsync = promisify(execFile);
export const GitChangesArgsSchema = {
    path: z.string().optional().describe("Directory or file to inspect git status/diff for (defaults to workspace root)"),
    diff: z.boolean().optional().describe("Whether to include unified diff output (default: true)"),
    staged: z.boolean().optional().describe("Filter to staged changes only (true), unstaged only (false), or both (omit/undefined)"),
    statOnly: z.boolean().optional().describe("Show only diffstat summary instead of full patch (default: false)"),
    maxDiffLines: z.number().optional().describe("Maximum diff lines to return to conserve tokens (default: 400)"),
};
export class GitChangesInspector {
    defaultRootDir;
    constructor(defaultRootDir = process.cwd()) {
        this.defaultRootDir = defaultRootDir;
    }
    resolveRepoDir(targetPath) {
        if (!targetPath)
            return this.defaultRootDir;
        const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(this.defaultRootDir, targetPath);
        return resolved;
    }
    parseStatusCode(x, y) {
        if (x === "?" && y === "?") {
            return { status: "untracked", staged: false };
        }
        if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
            return { status: "conflict", staged: false };
        }
        // Staged status in X column
        const isStaged = x !== " " && x !== "?";
        if (x === "M" || y === "M")
            return { status: "modified", staged: isStaged };
        if (x === "A" || y === "A")
            return { status: "added", staged: isStaged };
        if (x === "D" || y === "D")
            return { status: "deleted", staged: isStaged };
        if (x === "R" || y === "R")
            return { status: "renamed", staged: isStaged };
        return { status: "unknown", staged: isStaged };
    }
    async inspect(args = {}, abortSignal) {
        const startTime = performance.now();
        const resolvedPath = this.resolveRepoDir(args.path);
        let effectiveCwd = resolvedPath;
        let fileFilter = null;
        try {
            const st = await fs.stat(resolvedPath);
            if (st.isFile()) {
                effectiveCwd = path.dirname(resolvedPath);
                fileFilter = path.basename(resolvedPath);
            }
        }
        catch {
            // Path may not exist or be relative
        }
        // Verify if directory is a git repo
        let isGitRepo = false;
        let branch = "HEAD";
        let commit = "";
        try {
            const { stdout: topLevel } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
                cwd: effectiveCwd,
                timeout: 3000,
                signal: abortSignal,
            });
            if (topLevel.trim()) {
                isGitRepo = true;
            }
        }
        catch {
            return {
                isGitRepo: false,
                summary: { totalChanged: 0, modified: 0, added: 0, deleted: 0, untracked: 0, renamed: 0, stagedCount: 0 },
                files: [],
                durationMs: Math.round((performance.now() - startTime) * 100) / 100,
            };
        }
        // Get current branch and short commit hash
        try {
            const { stdout: branchOut } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
                cwd: effectiveCwd,
                timeout: 2000,
                signal: abortSignal,
            });
            branch = branchOut.trim() || "HEAD";
            const { stdout: commitOut } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
                cwd: effectiveCwd,
                timeout: 2000,
                signal: abortSignal,
            });
            commit = commitOut.trim();
        }
        catch {
            // Ignored if detached HEAD or fresh repo
        }
        // Run git status --porcelain=v1 -uall
        const statusArgs = ["-c", "core.quotepath=false", "status", "--porcelain=v1", "-uall"];
        if (fileFilter) {
            statusArgs.push("--", fileFilter);
        }
        let statusOutput = "";
        try {
            const { stdout } = await execFileAsync("git", statusArgs, {
                cwd: effectiveCwd,
                timeout: 3000,
                signal: abortSignal,
            });
            statusOutput = stdout;
        }
        catch (err) {
            statusOutput = "";
        }
        const files = [];
        const summary = {
            totalChanged: 0,
            modified: 0,
            added: 0,
            deleted: 0,
            untracked: 0,
            renamed: 0,
            stagedCount: 0,
        };
        if (statusOutput) {
            const lines = statusOutput.split("\n");
            for (const line of lines) {
                if (!line || line.length < 4)
                    continue;
                const x = line[0];
                const y = line[1];
                const rawPath = line.substring(3).trim();
                // Handle renamed paths only when status code indicates rename
                const filePath = (x === "R" || y === "R") && rawPath.includes(" -> ")
                    ? rawPath.split(" -> ")[1].trim()
                    : rawPath;
                const { status, staged } = this.parseStatusCode(x, y);
                // Filter based on staged flag if requested
                if (args.staged === true && !staged)
                    continue;
                if (args.staged === false && staged && x !== " " && y === " ")
                    continue;
                files.push({
                    path: filePath,
                    statusCode: line.substring(0, 2),
                    status,
                    staged,
                });
                summary.totalChanged++;
                if (staged)
                    summary.stagedCount++;
                if (status === "modified")
                    summary.modified++;
                else if (status === "added")
                    summary.added++;
                else if (status === "deleted")
                    summary.deleted++;
                else if (status === "untracked")
                    summary.untracked++;
                else if (status === "renamed")
                    summary.renamed++;
            }
        }
        let statResult;
        let diffResult;
        let diffTruncated = false;
        // Stat summary
        try {
            const statFlags = ["diff", "--stat"];
            if (args.staged === true) {
                statFlags.push("--cached");
            }
            if (fileFilter) {
                statFlags.push("--", fileFilter);
            }
            const { stdout: statOut } = await execFileAsync("git", statFlags, {
                cwd: effectiveCwd,
                timeout: 3000,
                signal: abortSignal,
            });
            statResult = statOut.trim();
        }
        catch {
            // Ignore stat error
        }
        // Full unified diff if requested and not statOnly
        const includeDiff = args.diff !== false && args.statOnly !== true;
        if (includeDiff && summary.totalChanged > 0) {
            try {
                const diffFlags = ["diff", "-U3"];
                if (args.staged === true) {
                    diffFlags.push("--cached");
                }
                else if (args.staged === undefined) {
                    // Both: diff HEAD to show working + staged combined vs HEAD
                    diffFlags.push("HEAD");
                }
                if (fileFilter) {
                    diffFlags.push("--", fileFilter);
                }
                const { stdout: diffOut } = await execFileAsync("git", diffFlags, {
                    cwd: effectiveCwd,
                    maxBuffer: 5 * 1024 * 1024,
                    timeout: 4000,
                    signal: abortSignal,
                });
                const maxLines = args.maxDiffLines || 400;
                const diffLines = diffOut.split("\n");
                if (diffLines.length > maxLines) {
                    diffResult = diffLines.slice(0, maxLines).join("\n") + `\n... [Diff truncated at ${maxLines} lines. ${diffLines.length - maxLines} more lines available]`;
                    diffTruncated = true;
                }
                else {
                    diffResult = diffOut.trim();
                }
            }
            catch (err) {
                // If git diff HEAD fails (e.g. initial repo without commit), fallback to plain git diff + cached diff
                try {
                    const fallbackFlags = ["diff"];
                    if (fileFilter)
                        fallbackFlags.push("--", fileFilter);
                    const { stdout: fallbackOut } = await execFileAsync("git", fallbackFlags, {
                        cwd: effectiveCwd,
                        timeout: 3000,
                        signal: abortSignal,
                    });
                    const cachedFlags = ["diff", "--cached"];
                    if (fileFilter)
                        cachedFlags.push("--", fileFilter);
                    const { stdout: cachedOut } = await execFileAsync("git", cachedFlags, {
                        cwd: effectiveCwd,
                        timeout: 3000,
                        signal: abortSignal,
                    });
                    const combined = (cachedOut + "\n" + fallbackOut).trim();
                    diffResult = combined || undefined;
                }
                catch {
                    diffResult = undefined;
                }
            }
        }
        const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
        return {
            isGitRepo,
            branch,
            commit,
            summary,
            files,
            stat: statResult,
            diff: diffResult,
            diffTruncated,
            durationMs,
        };
    }
}
//# sourceMappingURL=git-changes.js.map