import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { FastFileCache } from "./fast-cache.js";
import { FastSearch } from "./fast-search.js";
const hasBun = typeof Bun !== "undefined";
export const FindReplaceArgsSchema = {
    find: z.string().describe("Exact substring or regex pattern to search for"),
    replace: z.string().describe("Replacement text"),
    isRegex: z.boolean().optional().describe("Whether \"find\" is a regular expression pattern (default false)"),
    regexFlags: z.string().optional().default("g").describe("Regex flags if isRegex is true (e.g. \"g\", \"gi\")"),
    path: z.string().optional().describe("Optional subdirectory or glob pattern (e.g. \"src/**/*.ts\")"),
    dryRun: z.boolean().optional().describe("Preview matching files and occurrence counts without writing to disk"),
    maxFiles: z.number().int().optional().default(50).describe("Max files to modify (default 50)"),
};
export class FindReplaceEngine {
    baseDir;
    cache = FastFileCache.getInstance();
    searcher;
    constructor(baseDir = process.cwd()) {
        this.baseDir = path.resolve(baseDir);
        this.searcher = new FastSearch(this.baseDir);
    }
    async executeFindReplace(args, sessionDir) {
        const t0 = performance.now();
        const effectiveDir = sessionDir ? path.resolve(sessionDir) : this.baseDir;
        const maxFiles = args.maxFiles ?? 50;
        const dryRun = args.dryRun ?? false;
        if (!args.find) {
            return "Error: \"find\" parameter is required.";
        }
        // 1. Locate candidate files using FastSearch
        const searchTarget = args.path ? path.resolve(effectiveDir, args.path) : effectiveDir;
        let candidateFiles = [];
        let isSingleFile = false;
        try {
            const st = await fs.stat(searchTarget);
            if (st.isFile()) {
                isSingleFile = true;
                candidateFiles = [searchTarget];
            }
        }
        catch { }
        if (!isSingleFile) {
            if (!args.isRegex) {
                const grepRes = await this.searcher.grep(args.find, searchTarget, 500);
                candidateFiles = Array.from(new Set(grepRes.matches.map((m) => m.file)));
            }
            else {
                const globRes = await this.searcher.glob(undefined, searchTarget, 500);
                candidateFiles = globRes.matches;
            }
        }
        if (candidateFiles.length === 0) {
            return `No matching files found for "${args.find}" (${Math.round(performance.now() - t0)}ms).`;
        }
        // 2. Perform in-memory replacements
        const modifiedMap = new Map();
        const originalContentMap = new Map();
        const summaries = [];
        for (const relFile of candidateFiles) {
            if (summaries.length >= maxFiles)
                break;
            const absPath = path.isAbsolute(relFile) ? relFile : path.resolve(effectiveDir, relFile);
            const relFromEffective = path.relative(effectiveDir, absPath);
            if (relFromEffective.startsWith("..") || path.isAbsolute(relFromEffective))
                continue;
            let content = await this.cache.get(absPath);
            if (content === null) {
                try {
                    if (hasBun) {
                        content = await Bun.file(absPath).text();
                    }
                    else {
                        content = await fs.readFile(absPath, "utf-8");
                    }
                }
                catch {
                    continue;
                }
            }
            let count = 0;
            let updated = content;
            if (args.isRegex) {
                const flags = args.regexFlags || "g";
                const re = new RegExp(args.find, flags.includes("g") ? flags : flags + "g");
                const matches = content.match(re);
                if (matches) {
                    count = matches.length;
                    // Use replacer function () => args.replace to avoid $ sequence injection bugs
                    updated = content.replace(re, () => args.replace);
                }
            }
            else {
                if (content.includes(args.find)) {
                    const parts = content.split(args.find);
                    count = parts.length - 1;
                    updated = parts.join(args.replace);
                }
            }
            if (count > 0) {
                summaries.push({ file: relFromEffective, matches: count });
                originalContentMap.set(absPath, content);
                modifiedMap.set(absPath, updated);
            }
        }
        const durationMs = Math.round(performance.now() - t0);
        const totalMatches = summaries.reduce((acc, s) => acc + s.matches, 0);
        if (summaries.length === 0) {
            return `Pattern "${args.find}" was not found in candidate files (${durationMs}ms).`;
        }
        if (dryRun) {
            let out = `🔍 **find_replace preview (dryRun: true)**: ${totalMatches} match(es) across ${summaries.length} file(s) (${durationMs}ms)\n\n`;
            out += "| # | File | Matches |\n";
            out += "| :-: | :--- | :-: |\n";
            summaries.forEach((s, i) => {
                out += `| ${i + 1} | \`${s.file}\` | ${s.matches} |\n`;
            });
            out += "\n*No files were written to disk.*";
            return out;
        }
        // 3. Write all modified files with compensation rollback
        try {
            await Promise.all(Array.from(modifiedMap.entries()).map(async ([absPath, newContent]) => {
                if (hasBun) {
                    await Bun.write(absPath, newContent);
                }
                else {
                    await fs.writeFile(absPath, newContent, "utf-8");
                }
                this.cache.set(absPath, newContent);
            }));
        }
        catch (writeErr) {
            // Rollback compensation: restore original contents
            await Promise.all(Array.from(originalContentMap.entries()).map(async ([absPath, originalText]) => {
                try {
                    await fs.writeFile(absPath, originalText, "utf-8");
                    this.cache.set(absPath, originalText);
                }
                catch { }
            }));
            return `❌ find_replace failed during disk write: ${writeErr.message || String(writeErr)}. All files rolled back.`;
        }
        const totalDuration = Math.round(performance.now() - t0);
        let out = `✓ **Replaced ${totalMatches} occurrence(s) across ${summaries.length} file(s)** in ${totalDuration}ms\n\n`;
        out += "| # | File | Replacements |\n";
        out += "| :-: | :--- | :-: |\n";
        summaries.forEach((s, i) => {
            out += `| ${i + 1} | \`${s.file}\` | ${s.matches} |\n`;
        });
        return out;
    }
}
//# sourceMappingURL=find-replace.js.map