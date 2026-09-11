import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { FastFileCache } from "./fast-cache.js";

export const OutlineArgsSchema = {
  path: z.string().optional().describe("Path of the file to outline"),
  filePath: z.string().optional().describe("Alternative file path parameter"),
  maxDepth: z.number().int().optional().default(3).describe("Max nesting depth for classes/namespaces"),
};

export interface CodeSymbol {
  line: number;
  kind: "class" | "interface" | "type" | "function" | "method" | "enum" | "const" | "struct" | "trait" | "impl";
  name: string;
  signature: string;
  exported: boolean;
}

export class CodeOutliner {
  private baseDir: string;
  private cache = FastFileCache.getInstance();

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = path.resolve(baseDir);
  }

  public async getOutline(
    args: { path?: string; filePath?: string; maxDepth?: number },
    sessionDir?: string
  ): Promise<string> {
    const rawPath = args.path || args.filePath;
    if (!rawPath) return "Error: file path is required.";

    const effectiveDir = sessionDir ? path.resolve(sessionDir) : this.baseDir;
    const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(effectiveDir, rawPath);
    const relPath = path.relative(effectiveDir, absPath);
    const t0 = performance.now();

    let content = await this.cache.get(absPath);
    if (content === null) {
      try {
        content = await fs.readFile(absPath, "utf-8");
      } catch {
        return `Error: File not found: ${relPath}`;
      }
    }

    const ext = path.extname(absPath).toLowerCase();
    const symbols = this.parseSymbols(content, ext);
    const durationMs = Math.round(performance.now() - t0);
    const lineCount = content.split("\n").length;

    if (symbols.length === 0) {
      return `### Outline of \`${relPath}\` (${lineCount} lines, ${durationMs}ms)\n*No top-level functions, classes, or types found.*\nTotal lines: ${lineCount}`;
    }

    let out = `### 🧭 Outline of \`${relPath}\` (${symbols.length} symbols, ${lineCount} lines in ${durationMs}ms)\n\n`;
    out += "| Line | Kind | Export | Name / Signature |\n";
    out += "| ---: | :--- | :---: | :--- |\n";

    for (const s of symbols) {
      const expIcon = s.exported ? "✓" : "·";
      out += `| ${s.line} | ${s.kind} | ${expIcon} | \`${s.signature}\` |\n`;
    }

    return out;
  }

  private parseSymbols(content: string, ext: string): CodeSymbol[] {
    const lines = content.split("\n");
    const symbols: CodeSymbol[] = [];

    // TypeScript / JavaScript / TSX / JSX
    if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const lineNum = i + 1;

        if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

        const isExport = /^export\s+/.test(trimmed);
        const withoutExport = trimmed.replace(/^export\s+(default\s+)?/, "");

        // 1. Class
        let m = withoutExport.match(/^(abstract\s+)?class\s+([A-Za-z0-9_$]+)(<[^>]+>)?(\s+extends\s+[A-Za-z0-9_$]+)?/);
        if (m) {
          symbols.push({
            line: lineNum,
            kind: "class",
            name: m[2],
            signature: `class ${m[2]}`,
            exported: isExport,
          });
          continue;
        }

        // 2. Interface
        m = withoutExport.match(/^interface\s+([A-Za-z0-9_$]+)(<[^>]+>)?/);
        if (m) {
          symbols.push({
            line: lineNum,
            kind: "interface",
            name: m[1],
            signature: `interface ${m[1]}`,
            exported: isExport,
          });
          continue;
        }

        // 3. Type alias
        m = withoutExport.match(/^type\s+([A-Za-z0-9_$]+)(<[^>]+>)?\s*=/);
        if (m) {
          symbols.push({
            line: lineNum,
            kind: "type",
            name: m[1],
            signature: `type ${m[1]}`,
            exported: isExport,
          });
          continue;
        }

        // 4. Enum
        m = withoutExport.match(/^enum\s+([A-Za-z0-9_$]+)/);
        if (m) {
          symbols.push({
            line: lineNum,
            kind: "enum",
            name: m[1],
            signature: `enum ${m[1]}`,
            exported: isExport,
          });
          continue;
        }

        // 5. Function (handles single-line and multiline signatures)
        m = withoutExport.match(/^(async\s+)?function\s*\*?\s+([A-Za-z0-9_$]+)\s*\((.*)/);
        if (m) {
          const fnName = m[2];
          let params = m[3].replace(/\s+/g, " ").trim();
          if (params.includes(")")) {
            params = params.slice(0, params.indexOf(")"));
          } else {
            params = "...";
          }
          symbols.push({
            line: lineNum,
            kind: "function",
            name: fnName,
            signature: `function ${fnName}(${params})`,
            exported: isExport,
          });
          continue;
        }

        // 6. Exported const / let arrow function
        m = withoutExport.match(/^(const|let)\s+([A-Za-z0-9_$]+)\s*(:\s*[^=]+)?\s*=\s*(\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/);
        if (m) {
          symbols.push({
            line: lineNum,
            kind: "function",
            name: m[2],
            signature: `const ${m[2]} = (...) =>`,
            exported: isExport,
          });
          continue;
        }

        // 7. Exported const tool definition
        if (isExport) {
          m = withoutExport.match(/^const\s+([A-Za-z0-9_$]+)\s*(:\s*[^=]+)?\s*=\s*([A-Za-z0-9_$]+)/);
          if (m) {
            symbols.push({
              line: lineNum,
              kind: "const",
              name: m[1],
              signature: `const ${m[1]}`,
              exported: true,
            });
            continue;
          }
        }
      }
    } else if (ext === ".py") {
      // Python parser
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const lineNum = i + 1;

        let m = trimmed.match(/^class\s+([A-Za-z0-9_]+)(\(([^)]*)\))?:/);
        if (m) {
          symbols.push({
            line: lineNum,
            kind: "class",
            name: m[1],
            signature: `class ${m[1]}`,
            exported: !m[1].startsWith("_"),
          });
          continue;
        }

        m = trimmed.match(/^(async\s+)?def\s+([A-Za-z0-9_]+)\s*\((.*)/);
        if (m) {
          const isMethod = line.startsWith(" ") || line.startsWith("\t");
          let params = m[3].trim();
          if (params.includes(")")) {
            params = params.slice(0, params.indexOf(")"));
          } else {
            params = "...";
          }
          symbols.push({
            line: lineNum,
            kind: isMethod ? "method" : "function",
            name: m[2],
            signature: `def ${m[2]}(${params})`,
            exported: !m[2].startsWith("_"),
          });
          continue;
        }
      }
    } else if (ext === ".go") {
      // Go parser
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        let m = line.match(/^func\s+(\(([^)]+)\)\s+)?([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
        if (m) {
          symbols.push({
            line: lineNum,
            kind: m[1] ? "method" : "function",
            name: m[3],
            signature: line.trim().replace(/\s*{.*$/, ""),
            exported: /^[A-Z]/.test(m[3]),
          });
          continue;
        }

        m = line.match(/^type\s+([A-Za-z0-9_]+)\s+(struct|interface)/);
        if (m) {
          symbols.push({
            line: lineNum,
            kind: m[2] === "struct" ? "struct" : "interface",
            name: m[1],
            signature: `type ${m[1]} ${m[2]}`,
            exported: /^[A-Z]/.test(m[1]),
          });
          continue;
        }
      }
    } else if (ext === ".rs") {
      // Rust parser
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const lineNum = i + 1;
        const isPub = /^pub(\([^)]*\))?\s+/.test(trimmed);

        // Support: pub(crate) fn, async fn, const fn, unsafe fn, struct, enum, trait, type
        let m = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe)\s+)?(fn|struct|enum|trait|type)\s+([A-Za-z0-9_]+)/);
        if (m) {
          symbols.push({
            line: lineNum,
            kind: (m[1] === "type" ? "type" : m[1]) as any,
            name: m[2],
            signature: trimmed.replace(/\s*[{;].*$/, ""),
            exported: isPub,
          });
          continue;
        }

        // Support: impl Foo or impl<T> Trait for Foo
        let implMatch = trimmed.match(/^impl(?:<[^>]*>)?\s+(?:([A-Za-z0-9_]+)\s+for\s+)?([A-Za-z0-9_]+)/);
        if (implMatch) {
          const name = implMatch[2];
          symbols.push({
            line: lineNum,
            kind: "impl",
            name,
            signature: trimmed.replace(/\s*{.*$/, ""),
            exported: false,
          });
          continue;
        }
      }
    }

    return symbols;
  }
}
