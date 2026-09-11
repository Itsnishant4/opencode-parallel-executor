import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { FastFileCache } from "./fast-cache.js";
const execFileAsync = promisify(execFile);
const hasBun = typeof Bun !== "undefined";
export const SnapshotArgsSchema = {
    message: z.string().optional().describe("Optional label or reason for checkpoint (e.g. before refactor)"),
    path: z.string().optional().describe("Workspace or repository directory"),
};
export const UndoArgsSchema = {
    snapshotId: z.string().optional().describe("ID of snapshot to restore (e.g. snap-1). Defaults to most recent snapshot."),
    path: z.string().optional().describe("Workspace or repository directory"),
};
export class WorkingTreeSnapshotManager {
    static instance;
    snapshots = [];
    nextId = 1;
    maxSnapshots = 20;
    cache = FastFileCache.getInstance();
    baseDir;
    constructor(baseDir = process.cwd()) {
        this.baseDir = path.resolve(baseDir);
    }
    static getInstance(baseDir = process.cwd()) {
        if (!WorkingTreeSnapshotManager.instance) {
            WorkingTreeSnapshotManager.instance = new WorkingTreeSnapshotManager(baseDir);
        }
        return WorkingTreeSnapshotManager.instance;
    }
    clear() {
        this.snapshots = [];
        this.nextId = 1;
    }
    async getDirtyFiles(targetDir) {
        try {
            const { stdout } = await execFileAsync("git", ["-c", "core.quotepath=false", "status", "--porcelain=v1", "-uall"], {
                cwd: targetDir,
                timeout: 5000,
            });
            if (!stdout.trim())
                return [];
            const lines = stdout.split("\n");
            const files = [];
            for (const line of lines) {
                if (!line || line.length < 4)
                    continue;
                const statusCode = line.substring(0, 2);
                const rawPath = line.substring(3).trim();
                const p = (statusCode.includes("R") && rawPath.includes(" -> ")) ? rawPath.split(" -> ")[1] : rawPath;
                const cleanPath = p.replace(/^"|"$/g, "");
                files.push({
                    path: cleanPath,
                    statusCode,
                    untracked: statusCode === "??" || statusCode === "? ",
                });
            }
            return files;
        }
        catch {
            return [];
        }
    }
    async takeSnapshot(args = {}, sessionDir) {
        const t0 = performance.now();
        const effectiveDir = sessionDir
            ? path.resolve(sessionDir)
            : args.path
                ? path.resolve(this.baseDir, args.path)
                : this.baseDir;
        const dirtyFiles = await this.getDirtyFiles(effectiveDir);
        const snapId = "snap-" + (this.nextId++);
        const timestamp = Date.now();
        const createdAt = new Date(timestamp).toLocaleTimeString();
        const fileEntries = new Map();
        for (const item of dirtyFiles) {
            const relPath = item.path;
            const absPath = path.resolve(effectiveDir, relPath);
            let content = null;
            let existed = false;
            try {
                const stat = await fs.stat(absPath);
                if (stat.isFile()) {
                    existed = true;
                    // Avoid reading huge files (> 2MB) into memory string
                    if (stat.size <= 2 * 1024 * 1024) {
                        content = await this.cache.get(absPath);
                        if (content === null) {
                            content = await fs.readFile(absPath, "utf-8");
                        }
                    }
                }
            }
            catch {
                existed = false;
                content = null;
            }
            fileEntries.set(relPath, {
                path: relPath,
                content,
                existed,
            });
        }
        const snapshot = {
            id: snapId,
            index: this.snapshots.length + 1,
            timestamp,
            createdAt,
            message: args.message || "Manual checkpoint",
            files: fileEntries,
        };
        this.snapshots.push(snapshot);
        if (this.snapshots.length > this.maxSnapshots) {
            this.snapshots.shift();
        }
        const durationMs = Math.round((performance.now() - t0) * 100) / 100;
        let out = `📸 **Snapshot Created: \`${snapId}\`** (${fileEntries.size} dirty file(s) captured in ${durationMs}ms)\n\n`;
        out += `**Message**: ${snapshot.message}\n`;
        out += `**Time**: ${createdAt}\n`;
        if (fileEntries.size > 0) {
            out += `\n| File | State in Snapshot |\n`;
            out += `| :--- | :--- |\n`;
            fileEntries.forEach((entry) => {
                out += `| \`${entry.path}\` | ${entry.existed ? "Modified / Saved" : "New / Untracked"} |\n`;
            });
        }
        else {
            out += `\n*Working tree was completely clean at checkpoint time.*\n`;
        }
        out += `\n*To rollback anytime, call:* \`undo(snapshotId: "${snapId}")\``;
        return out;
    }
    async restoreSnapshot(args = {}, sessionDir) {
        const t0 = performance.now();
        const effectiveDir = sessionDir
            ? path.resolve(sessionDir)
            : args.path
                ? path.resolve(this.baseDir, args.path)
                : this.baseDir;
        if (this.snapshots.length === 0) {
            return "⚠️ **undo**: No active snapshots available in history to restore.";
        }
        let targetSnapshot;
        if (args.snapshotId) {
            targetSnapshot = this.snapshots.find((s) => s.id === args.snapshotId);
            if (!targetSnapshot) {
                return `⚠️ **undo**: Snapshot with ID \`${args.snapshotId}\` not found in history.`;
            }
        }
        else {
            targetSnapshot = this.snapshots[this.snapshots.length - 1];
        }
        const currentDirty = await this.getDirtyFiles(effectiveDir);
        let restoredCount = 0;
        let deletedCount = 0;
        for (const [relPath, entry] of targetSnapshot.files.entries()) {
            const absPath = path.resolve(effectiveDir, relPath);
            if (entry.existed && entry.content !== null) {
                const dir = path.dirname(absPath);
                await fs.mkdir(dir, { recursive: true });
                if (hasBun) {
                    await Bun.write(absPath, entry.content);
                }
                else {
                    await fs.writeFile(absPath, entry.content, "utf-8");
                }
                this.cache.set(absPath, entry.content);
                restoredCount++;
            }
            else if (!entry.existed) {
                try {
                    await fs.unlink(absPath);
                    this.cache.invalidate(absPath);
                    deletedCount++;
                }
                catch {
                    // Ignore
                }
            }
        }
        // Handle files that were modified or created after the snapshot
        for (const dirtyItem of currentDirty) {
            const relPath = dirtyItem.path;
            if (!targetSnapshot.files.has(relPath)) {
                const absPath = path.resolve(effectiveDir, relPath);
                if (dirtyItem.untracked) {
                    // Untracked new file created after snapshot - safely remove
                    try {
                        await fs.unlink(absPath);
                        this.cache.invalidate(absPath);
                        deletedCount++;
                    }
                    catch {
                        // Ignore
                    }
                }
                else {
                    // Tracked file modified after snapshot - revert to HEAD via git, DO NOT UNLINK!
                    try {
                        await execFileAsync("git", ["checkout", "HEAD", "--", relPath], {
                            cwd: effectiveDir,
                            timeout: 3000,
                        });
                        this.cache.invalidate(absPath);
                        restoredCount++;
                    }
                    catch {
                        // Fallback to git restore if checkout fails
                        try {
                            await execFileAsync("git", ["restore", "--", relPath], {
                                cwd: effectiveDir,
                                timeout: 3000,
                            });
                            this.cache.invalidate(absPath);
                            restoredCount++;
                        }
                        catch {
                            // Ignore
                        }
                    }
                }
            }
        }
        const durationMs = Math.round((performance.now() - t0) * 100) / 100;
        return `✓ **Restored working tree to snapshot \`${targetSnapshot.id}\`** (${restoredCount} file(s) restored, ${deletedCount} new file(s) removed) in ${durationMs}ms.\n*Note: "${targetSnapshot.message}" from ${targetSnapshot.createdAt}*`;
    }
    listSnapshots() {
        if (this.snapshots.length === 0) {
            return "No snapshots currently recorded.";
        }
        let out = `### 📸 Working Tree Snapshots (${this.snapshots.length}/${this.maxSnapshots})\n\n`;
        out += "| Snapshot ID | Created At | Files Tracked | Message |\n";
        out += "| :--- | :---: | :---: | :--- |\n";
        for (let i = this.snapshots.length - 1; i >= 0; i--) {
            const s = this.snapshots[i];
            out += `| \`${s.id}\` | ${s.createdAt} | ${s.files.size} | ${s.message || "—"} |\n`;
        }
        return out;
    }
}
//# sourceMappingURL=snapshots.js.map