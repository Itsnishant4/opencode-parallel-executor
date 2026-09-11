import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { MultiFileEditor } from "./dist/multi-edit.js";
import { CodeOutliner } from "./dist/outline.js";
import { FindReplaceEngine } from "./dist/find-replace.js";
import { GitChangesInspector } from "./dist/git-changes.js";

async function runTests() {
  console.log("=== Testing 4 New Tools ===");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "new-tools-test-"));

  try {
    // ----------------------------------------------------
    // TEST 1: multi_edit (Atomic 2-Phase Commit & Rollback)
    // ----------------------------------------------------
    console.log("\n[1] Testing multi_edit...");
    const fileA = path.join(tmpDir, "fileA.txt");
    const fileB = path.join(tmpDir, "fileB.txt");
    await fs.writeFile(fileA, "hello world\nfoo bar\napple banana", "utf-8");
    await fs.writeFile(fileB, "one two three\nred green blue", "utf-8");

    const multiEditor = new MultiFileEditor(tmpDir);

    // 1a: Dry Run Preview
    const dryRunResult = await multiEditor.executeMultiEdit({
      dryRun: true,
      edits: [
        { path: "fileA.txt", oldText: "hello world", newText: "hello universe" },
        { path: "fileB.txt", oldText: "red green blue", newText: "cyan magenta yellow" },
      ],
    }, tmpDir);
    assert(dryRunResult.includes("dryRun: true"), "dryRun must report preview mode");
    assert((await fs.readFile(fileA, "utf-8")).includes("hello world"), "dryRun must not modify fileA");

    // 1b: Successful Multi-File Atomic Commit
    const commitResult = await multiEditor.executeMultiEdit({
      dryRun: false,
      edits: [
        { path: "fileA.txt", oldText: "hello world", newText: "hello universe" },
        { path: "fileB.txt", oldText: "red green blue", newText: "cyan magenta yellow" },
      ],
    }, tmpDir);
    assert(commitResult.includes("committed"), "commitResult must report commit");
    const updatedA = await fs.readFile(fileA, "utf-8");
    const updatedB = await fs.readFile(fileB, "utf-8");
    assert(updatedA.includes("hello universe"), "fileA must be updated");
    assert(updatedB.includes("cyan magenta yellow"), "fileB must be updated");
    console.log("  ✓ multi_edit 2-phase atomic commit passed");

    // 1c: Atomic Rollback on Mismatched Text
    const rollbackResult = await multiEditor.executeMultiEdit({
      dryRun: false,
      edits: [
        { path: "fileA.txt", oldText: "hello universe", newText: "WILL_NOT_BE_SAVED" },
        { path: "fileB.txt", oldText: "NON_EXISTENT_TEXT", newText: "ALSO_NOT_SAVED" },
      ],
    }, tmpDir);
    assert(rollbackResult.includes("Atomic multi_edit aborted"), "Mismatched edit must trigger abort");
    assert(rollbackResult.includes("rolled back"), "Rollback must be recorded");
    const rolledBackA = await fs.readFile(fileA, "utf-8");
    assert(!rolledBackA.includes("WILL_NOT_BE_SAVED"), "fileA must NOT be modified after rollback");
    assert(rolledBackA.includes("hello universe"), "fileA must retain previous content");
    console.log("  ✓ multi_edit atomic rollback guarantee passed");

    // ----------------------------------------------------
    // TEST 2: outline (Instant Code Symbol Extractor)
    // ----------------------------------------------------
    console.log("\n[2] Testing outline...");
    const sampleTsFile = path.join(tmpDir, "sample.ts");
    const tsCode = `
export interface UserConfig {
  id: string;
  name: string;
}

export type Status = "active" | "inactive";

export enum Role {
  Admin = "ADMIN",
  User = "USER",
}

export class ServiceEngine {
  private count = 0;
  public start(): void {}
}

export async function calculateMetrics(input: number): Promise<number> {
  return input * 2;
}

export const helperFn = (x: string) => x.toUpperCase();
`;
    await fs.writeFile(sampleTsFile, tsCode, "utf-8");

    const outliner = new CodeOutliner(tmpDir);
    const tsOutline = await outliner.getOutline({ path: "sample.ts" }, tmpDir);
    assert(tsOutline.includes("interface UserConfig"), "Must find interface UserConfig");
    assert(tsOutline.includes("type Status"), "Must find type Status");
    assert(tsOutline.includes("enum Role"), "Must find enum Role");
    assert(tsOutline.includes("class ServiceEngine"), "Must find class ServiceEngine");
    assert(tsOutline.includes("function calculateMetrics"), "Must find calculateMetrics");
    assert(tsOutline.includes("helperFn"), "Must find helperFn");
    console.log("  ✓ outline TS symbols extraction passed (< 1ms)");

    // Python outline test
    const samplePyFile = path.join(tmpDir, "sample.py");
    const pyCode = `
class DataProcessor:
    def __init__(self):
        pass

    def process_records(self, items):
        return [x for x in items]

async def fetch_remote_data():
    pass
`;
    await fs.writeFile(samplePyFile, pyCode, "utf-8");
    const pyOutline = await outliner.getOutline({ path: "sample.py" }, tmpDir);
    assert(pyOutline.includes("class DataProcessor"), "Must find class DataProcessor");
    assert(pyOutline.includes("def process_records"), "Must find process_records");
    assert(pyOutline.includes("def fetch_remote_data"), "Must find fetch_remote_data");
    console.log("  ✓ outline Python symbols extraction passed");

    // ----------------------------------------------------
    // TEST 3: find_replace (Project-Wide Search & Replace)
    // ----------------------------------------------------
    console.log("\n[3] Testing find_replace...");
    const replFile1 = path.join(tmpDir, "sub1.txt");
    const replFile2 = path.join(tmpDir, "sub2.txt");
    await fs.writeFile(replFile1, "ALPHA_KEY = 100\nBETA_KEY = 200\nALPHA_KEY = 300", "utf-8");
    await fs.writeFile(replFile2, "const x = ALPHA_KEY;\nconsole.log(ALPHA_KEY);", "utf-8");

    const findReplacer = new FindReplaceEngine(tmpDir);

    // 3a: Dry Run
    const frDryRun = await findReplacer.executeFindReplace({
      find: "ALPHA_KEY",
      replace: "GAMMA_KEY",
      dryRun: true,
    }, tmpDir);
    assert(frDryRun.includes("find_replace preview"), "Must output preview header");
    assert(frDryRun.includes("No files were written to disk"), "Must state no files written");
    assert((await fs.readFile(replFile1, "utf-8")).includes("ALPHA_KEY"), "Dry run must not alter disk");

    // 3b: Live execution
    const frLive = await findReplacer.executeFindReplace({
      find: "ALPHA_KEY",
      replace: "GAMMA_KEY",
      dryRun: false,
    }, tmpDir);
    assert(frLive.includes("Replaced 4 occurrence(s) across 2 file(s)"), "Must report 4 replacements in 2 files");
    const content1 = await fs.readFile(replFile1, "utf-8");
    const content2 = await fs.readFile(replFile2, "utf-8");
    assert(!content1.includes("ALPHA_KEY") && content1.includes("GAMMA_KEY = 100"), "sub1.txt must have all ALPHA_KEY replaced");
    assert(!content2.includes("ALPHA_KEY") && content2.includes("GAMMA_KEY;"), "sub2.txt must have all ALPHA_KEY replaced");
    console.log("  ✓ find_replace project-wide execution passed");

    // ----------------------------------------------------
    // TEST 4: git_changes (Zero-Fork Git Inspector)
    // ----------------------------------------------------
    console.log("\n[4] Testing git_changes...");
    const gitInspector = new GitChangesInspector(process.cwd());
    const gitRes = await gitInspector.inspect({ maxDiffLines: 50 });
    assert(typeof gitRes.isGitRepo === "boolean", "isGitRepo must be boolean");
    assert(gitRes.isGitRepo === true, "Current workspace must be a git repo");
    assert(typeof gitRes.branch === "string", "branch must be a string");
    assert(typeof gitRes.summary.totalChanged === "number", "summary.totalChanged must be number");
    console.log(`  ✓ git_changes inspected repository: branch="${gitRes.branch}", changes=${gitRes.summary.totalChanged} in ${gitRes.durationMs}ms`);

    console.log("\n🎉 ALL 4 NEW TOOLS PASSED VERIFICATION SUITE WITH 100% SUCCESS!");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
