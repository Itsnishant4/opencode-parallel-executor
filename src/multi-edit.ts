import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { FastFileCache } from "./fast-cache.js";

declare const Bun: {
  file(path: string): { text(): Promise<string> };
  write(destination: string, data: string | Uint8Array): Promise<number>;
} | undefined;

const hasBun = typeof Bun !== "undefined";

export const MultiEditItemSchema = z.object({
  path: z.string().describe("Target file path to edit"),
  oldText: z.string().describe("Exact substring to replace"),
  newText: z.string().describe("Replacement text"),
  replaceAll: z.boolean().optional().describe("Whether to replace all occurrences (default false)"),
});

export const MultiEditArgsSchema = {
  edits: z.array(MultiEditItemSchema).min(1).describe("Array of file edits to apply in an atomic transaction"),
  dryRun: z.boolean().optional().describe("Preview the edits without modifying files on disk"),
};

export interface MultiEditChangeSummary {
  path: string;
  replacements: number;
  oldSnippet: string;
  newSnippet: string;
}

export class MultiFileEditor {
  private baseDir: string;
  private cache = FastFileCache.getInstance();

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = path.resolve(baseDir);
  }

  /**
   * Applies multiple edits across one or more files in an atomic 2-phase transaction.
   * If any single edit cannot be applied (e.g. oldText not found), NO files are touched.
   */
  public async executeMultiEdit(
    args: { edits: Array<{ path: string; oldText: string; newText: string; replaceAll?: boolean }>; dryRun?: boolean },
    sessionDir?: string
  ): Promise<string> {
    const t0 = performance.now();
    const effectiveDir = sessionDir ? path.resolve(sessionDir) : this.baseDir;
    const dryRun = args.dryRun ?? false;

    // Phase 1: Group edits by file and stage in RAM
    const fileEditsMap = new Map<string, Array<{ oldText: string; newText: string; replaceAll?: boolean; index: number }>>();

    for (let i = 0; i < args.edits.length; i++) {
      const edit = args.edits[i];
      const relPath = edit.path;
      const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(effectiveDir, relPath);
      const relative = path.relative(effectiveDir, absPath);

      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return `❌ Atomic multi_edit aborted: Path "${relPath}" escapes workspace directory. No files were modified.`;
      }

      if (!fileEditsMap.has(absPath)) {
        fileEditsMap.set(absPath, []);
      }
      fileEditsMap.get(absPath)!.push({
        oldText: edit.oldText,
        newText: edit.newText,
        replaceAll: edit.replaceAll,
        index: i + 1,
      });
    }

    const stagedContentMap = new Map<string, string>();
    const originalContentMap = new Map<string, string>();
    const changeSummaries: MultiEditChangeSummary[] = [];

    // Phase 2: Validate all edits against file contents in memory
    for (const [absPath, edits] of fileEditsMap.entries()) {
      let content = await this.cache.get(absPath);
      const relPath = path.relative(effectiveDir, absPath);

      if (content === null) {
        try {
          if (hasBun) {
            content = await Bun.file(absPath).text();
          } else {
            content = await fs.readFile(absPath, "utf-8");
          }
        } catch {
          return `❌ Atomic multi_edit aborted: File not found "${relPath}". No files were modified.`;
        }
      }

      originalContentMap.set(absPath, content);
      let currentContent = content;

      for (const edit of edits) {
        if (!currentContent.includes(edit.oldText)) {
          const preview = edit.oldText.length > 80 ? edit.oldText.slice(0, 77) + "..." : edit.oldText;
          return `❌ Atomic multi_edit aborted at Edit #${edit.index} in "${relPath}":\nTarget substring not found:\n\`\`\`text\n${preview}\n\`\`\`\nTransaction rolled back. Zero files were modified.`;
        }

        let replacements = 1;
        if (edit.replaceAll) {
          const parts = currentContent.split(edit.oldText);
          replacements = parts.length - 1;
          currentContent = parts.join(edit.newText);
        } else {
          // Use replacer function () => edit.newText to prevent $ pattern substitution
          currentContent = currentContent.replace(edit.oldText, () => edit.newText);
        }

        const oldSnip = edit.oldText.split("\n")[0].trim().slice(0, 40);
        const newSnip = edit.newText.split("\n")[0].trim().slice(0, 40);

        changeSummaries.push({
          path: relPath,
          replacements,
          oldSnippet: oldSnip || "(empty)",
          newSnippet: newSnip || "(empty)",
        });
      }

      stagedContentMap.set(absPath, currentContent);
    }

    const durationMs = Math.round(performance.now() - t0);

    // If dry run, return preview table without touching disk
    if (dryRun) {
      let out = `🔍 **multi_edit preview (dryRun: true)**: ${args.edits.length} edit(s) across ${stagedContentMap.size} file(s) would succeed (${durationMs}ms)\n\n`;
      out += "| # | File | Occurrences | Old Preview | New Preview |\n";
      out += "| :-: | :--- | :-: | :--- | :--- |\n";
      changeSummaries.forEach((c, i) => {
        out += `| ${i + 1} | \`${c.path}\` | ${c.replacements} | \`${c.oldSnippet}\` | \`${c.newSnippet}\` |\n`;
      });
      out += "\n*No files were written to disk.*";
      return out;
    }

    // Phase 3: Commit all staged changes to disk with compensation rollback
    try {
      await Promise.all(
        Array.from(stagedContentMap.entries()).map(async ([absPath, updatedText]) => {
          const dir = path.dirname(absPath);
          await fs.mkdir(dir, { recursive: true });

          if (hasBun) {
            await Bun.write(absPath, updatedText);
          } else {
            await fs.writeFile(absPath, updatedText, "utf-8");
          }

          this.cache.set(absPath, updatedText);
        })
      );
    } catch (writeErr: any) {
      // Rollback compensation: restore original contents to disk and cache
      await Promise.all(
        Array.from(originalContentMap.entries()).map(async ([absPath, originalText]) => {
          try {
            await fs.writeFile(absPath, originalText, "utf-8");
            this.cache.set(absPath, originalText);
          } catch {}
        })
      );
      return `❌ Atomic multi_edit write failed: ${writeErr.message || String(writeErr)}. All files rolled back to original contents.`;
    }

    const totalDuration = Math.round(performance.now() - t0);
    let out = `✓ **Atomically committed ${args.edits.length} edit(s) across ${stagedContentMap.size} file(s)** in ${totalDuration}ms\n\n`;
    out += "| # | File | Occurrences | Old Preview | New Preview |\n";
    out += "| :-: | :--- | :-: | :--- | :--- |\n";
    changeSummaries.forEach((c, i) => {
      out += `| ${i + 1} | \`${c.path}\` | ${c.replacements} | \`${c.oldSnippet}\` | \`${c.newSnippet}\` |\n`;
    });

    return out;
  }
}
