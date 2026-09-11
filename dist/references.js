import path from "node:path";
import { z } from "zod";
import { FastSearch } from "./fast-search.js";
export const FindReferencesArgsSchema = {
    symbol: z.string().describe("Symbol name (function, class, interface, type, or variable) to find references for"),
    path: z.string().optional().describe("Directory or file to search within (defaults to workspace root)"),
    maxResults: z.number().int().optional().default(50).describe("Maximum references to return (default 50)"),
};
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function makeWordRegex(symbol) {
    const escaped = escapeRegex(symbol);
    const leftBoundary = /^\w/.test(symbol) ? "\\b" : "";
    const rightBoundary = /\w$/.test(symbol) ? "\\b" : "";
    return new RegExp(`${leftBoundary}${escaped}${rightBoundary}`);
}
export class CodeReferenceLocator {
    baseDir;
    searcher;
    constructor(baseDir = process.cwd()) {
        this.baseDir = path.resolve(baseDir);
        this.searcher = new FastSearch(this.baseDir);
    }
    classifyUsage(line, symbol) {
        const trimmed = line.trim();
        const escaped = escapeRegex(symbol);
        // 1. Definition patterns
        if (new RegExp(`^(export\\s+)?(default\\s+)?(async\\s+)?(function|class|interface|type|enum)\\s+${escaped}\\b`).test(trimmed) ||
            new RegExp(`^(export\\s+)?(const|let|var)\\s+${escaped}\\s*[:=]`).test(trimmed) ||
            new RegExp(`^(async\\s+)?def\\s+${escaped}\\b`).test(trimmed) ||
            new RegExp(`^func\\s+(\\([^)]*\\)\\s+)?${escaped}\\b`).test(trimmed) ||
            new RegExp(`^(pub(\\([^)]*\\))?\\s+)?(async\\s+)?(fn|struct|enum|trait|type)\\s+${escaped}\\b`).test(trimmed)) {
            return "definition";
        }
        // 2. Import patterns
        if (/^import\b/.test(trimmed) ||
            /\brequire\(/.test(trimmed) ||
            /^from\s+.*\s+import\b/.test(trimmed) ||
            /^use\s+.*::/.test(trimmed)) {
            return "import";
        }
        // 3. Call patterns (including generics <T> and Rust macros !)
        if (new RegExp(`\\b${escaped}\\s*(?:<[^>]+>)?\\s*\\(`).test(trimmed) ||
            new RegExp(`\\b${escaped}!\\s*\\(`).test(trimmed) ||
            new RegExp(`new\\s+${escaped}\\s*(?:<[^>]+>)?\\s*\\(`).test(trimmed) ||
            new RegExp(`<${escaped}\\b`).test(trimmed)) {
            return "call";
        }
        return "usage";
    }
    async findReferences(args, sessionDir) {
        const t0 = performance.now();
        const symbol = args.symbol.trim();
        if (!symbol)
            return "Error: symbol name is required.";
        const root = sessionDir ? path.resolve(sessionDir) : this.baseDir;
        const effectiveDir = args.path ? path.resolve(root, args.path) : root;
        const maxResults = args.maxResults || 50;
        // Search for raw symbol literal to support both git grep and fallback JS grep
        const searchRes = await this.searcher.grep(symbol, effectiveDir, maxResults * 4);
        const references = [];
        const wordRegex = makeWordRegex(symbol);
        for (const match of searchRes.matches) {
            if (!wordRegex.test(match.content))
                continue;
            const kind = this.classifyUsage(match.content, symbol);
            references.push({
                file: match.file,
                line: match.line,
                kind,
                snippet: match.content.trim(),
            });
            if (references.length >= maxResults)
                break;
        }
        const durationMs = Math.round(performance.now() - t0);
        if (references.length === 0) {
            return `No references found for symbol "\`${symbol}\`" (${durationMs}ms).`;
        }
        const definitions = references.filter((r) => r.kind === "definition").length;
        const imports = references.filter((r) => r.kind === "import").length;
        const calls = references.filter((r) => r.kind === "call").length;
        const usages = references.filter((r) => r.kind === "usage").length;
        let out = `### 🔍 Symbol References: \`${symbol}\` (${references.length} found in ${durationMs}ms)\n\n`;
        out += `**Breakdown**: ${definitions} definition(s), ${imports} import(s), ${calls} call(s), ${usages} other usage(s)\n\n`;
        out += "| Line | Kind | File | Code Snippet |\n";
        out += "| ---: | :---: | :--- | :--- |\n";
        references.forEach((r) => {
            const kindBadge = r.kind === "definition"
                ? "🌟 DEF"
                : r.kind === "import"
                    ? "📦 IMP"
                    : r.kind === "call"
                        ? "⚡ CALL"
                        : "· USE";
            const cleanSnippet = r.snippet.length > 70 ? r.snippet.slice(0, 67) + "..." : r.snippet;
            out += `| ${r.line} | ${kindBadge} | \`${r.file}\` | \`${cleanSnippet}\` |\n`;
        });
        return out;
    }
}
//# sourceMappingURL=references.js.map