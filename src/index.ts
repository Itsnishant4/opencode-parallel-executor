import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import path from "node:path";
import fs from "node:fs/promises";
import { ParallelExecuteArgsSchema } from "./types.js";
import { DependencyGraph } from "./dependency-graph.js";
import { TaskExecutor } from "./executor.js";
import { ResultFormatter } from "./formatter.js";
import { injectSystemInstructions } from "./system-prompt.js";
import { FastFileCache } from "./fast-cache.js";
import { FastBashRunner } from "./fast-bash.js";
import { PersistentShell } from "./persistent-shell.js";
import { FastSearch } from "./fast-search.js";
import { FastWatcher } from "./fast-watcher.js";
import { OutputCompactor } from "./compact-output.js";
import { BatchExecutor, BatchExecuteArgsSchema } from "./batch-tool.js";
import { MultiFileEditor, MultiEditArgsSchema } from "./multi-edit.js";
import { CodeOutliner, OutlineArgsSchema } from "./outline.js";
import { FindReplaceEngine, FindReplaceArgsSchema } from "./find-replace.js";
import { GitChangesInspector, GitChangesArgsSchema } from "./git-changes.js";
import { CodebaseVerifier, VerifyArgsSchema } from "./verifier.js";
import { WorkingTreeSnapshotManager, SnapshotArgsSchema, UndoArgsSchema } from "./snapshots.js";
import { CodeReferenceLocator, FindReferencesArgsSchema } from "./references.js";
import {
  BackgroundTerminalManager,
  BackgroundRunArgsSchema,
  BackgroundStatusArgsSchema,
  BackgroundLogsArgsSchema,
  BackgroundInputArgsSchema,
  BackgroundStopArgsSchema,
  BackgroundTerminalMasterArgsSchema,
} from "./background-terminal.js";

declare const Bun: {
  file(path: string): { text(): Promise<string> };
  write(destination: string, data: string | Uint8Array): Promise<number>;
} | undefined;

const hasBun = typeof Bun !== "undefined";

export const ParallelExecutorPlugin: Plugin = async (pluginInput: PluginInput) => {
  const rootDir = pluginInput.directory || pluginInput.worktree || process.cwd();
  const cache = FastFileCache.getInstance();
  const bashRunner = new FastBashRunner(rootDir);
  const searcher = new FastSearch(rootDir);
  const batchExecutor = new BatchExecutor(rootDir);
  const multiEditor = new MultiFileEditor(rootDir);
  const outliner = new CodeOutliner(rootDir);
  const findReplacer = new FindReplaceEngine(rootDir);
  const gitInspector = new GitChangesInspector(rootDir);
  const verifier = new CodebaseVerifier(rootDir);
  const snapshotManager = WorkingTreeSnapshotManager.getInstance(rootDir);
  const refLocator = new CodeReferenceLocator(rootDir);
  const bgManager = BackgroundTerminalManager.getInstance(rootDir);

  // Initialize background RAM pre-warming and native filesystem kqueue watcher
  const watcher = FastWatcher.getInstance(rootDir);
  watcher.start();

  // 1. High-Concurrency Batch Executor (5-10+ Parallel Execution Lanes)
  const batchExecuteTool = tool({
    description:
      "Execute 5, 10, or more operations (shell commands, file reads, writes, edits) simultaneously in high-concurrency parallel lanes (default 10 parallel lanes). ALWAYS use this when running multiple commands (e.g. 5 or 10 tests/lints/builds) or reading multiple files in parallel.",
    args: BatchExecuteArgsSchema,
    async execute(args, context) {
      return batchExecutor.runBatch(args, context?.abort, context?.directory);
    },
  });

  // 2. Unified Master Parallel DAG Executor
  const parallelExecuteTool = tool({
    description:
      "Execute multiple file reads, file writes, file edits, and shell commands in parallel batches with automatic dependency analysis, concurrency throttling, and rollback safety. Use for multi-step dependent operations.",
    args: ParallelExecuteArgsSchema,
    async execute(args, context) {
      const execDir = context?.directory || rootDir;
      const { reads = [], writes = [], edits = [], commands = [], options = {} } = args;
      const ops = DependencyGraph.normalizeOperations(reads, writes, edits, commands);

      if (ops.length === 0) {
        return "⚠️ No operations provided to parallel_execute. Please supply reads, writes, edits, or commands.";
      }

      try {
        const resolvedOps = DependencyGraph.resolveFineGrainedDependencies(ops, execDir);
        const executor = new TaskExecutor(execDir, options, context?.abort);
        const result = await executor.executeContinuousDAG(resolvedOps);
        return ResultFormatter.format(result);
      } catch (err: any) {
        return `❌ Parallel execution failed: ${err.message || String(err)}`;
      }
    },
  });

  // 2. Ultra-Fast Reader (Direct drop-in for "read" and "fast_read")
  const fastReadTool = tool({
    description:
      "MANDATORY file reader (< 0.05ms). Always use this tool (NOT bash cat/head) to inspect file content or specific line ranges (startLine, endLine) from zero-latency RAM cache.",
    args: {
      path: tool.schema.string().optional().describe("Path of the file to read"),
      filePath: tool.schema.string().optional().describe("Alternative file path"),
      startLine: tool.schema.number().int().min(1).optional().describe("Starting line (1-indexed, e.g. 1)"),
      endLine: tool.schema.number().int().min(1).optional().describe("Ending line (1-indexed, e.g. 60)"),
      lines: tool.schema.string().optional().describe("Line range string, e.g. '1-60'"),
      offset: tool.schema.number().int().min(0).optional().describe("0-indexed line offset"),
      limit: tool.schema.number().int().min(1).optional().describe("Line limit"),
      withLineNumbers: tool.schema.boolean().optional().describe("Whether to prefix line numbers"),
    },
    async execute(args, context) {
      const sessionDir = context?.directory || rootDir;
      const rawPath = args.path || args.filePath;
      if (!rawPath) return "Error: file path is required.";

      const targetPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(sessionDir, rawPath);
      const t0 = Date.now();

      let startLine = args.startLine;
      let endLine = args.endLine;

      if (args.lines) {
        const m = args.lines.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
        if (m) {
          startLine = parseInt(m[1], 10);
          endLine = parseInt(m[2], 10);
        }
      }

      // Handle offset / limit
      if (startLine === undefined && endLine === undefined && (args.offset !== undefined || args.limit !== undefined)) {
        const offset = args.offset ?? 0;
        startLine = offset + 1;
        endLine = args.limit !== undefined ? offset + args.limit : undefined;
      }

      try {
        if (startLine !== undefined && endLine !== undefined) {
          const res = await cache.getLines(targetPath, startLine, endLine, args.withLineNumbers ?? true);
          if (res) return OutputCompactor.compactFile(res.content);
        }

        const content = await cache.get(targetPath);
        if (content !== null) return OutputCompactor.compactFile(content);

        return `File not found: ${rawPath}`;
      } catch (err: any) {
        return `Error reading file ${rawPath}: ${err.message || String(err)}`;
      }
    },
  });

  // 3. Ultra-Fast Writer (Direct drop-in for "write" and "fast_write")
  const fastWriteTool = tool({
    description:
      "MANDATORY file writer (< 1ms). Always use this tool (NOT bash echo/cat/tee) to create new files or completely overwrite existing files.",
    args: {
      path: tool.schema.string().optional().describe("Path of the file to write to"),
      filePath: tool.schema.string().optional().describe("Alternative file path"),
      content: tool.schema.string().describe("Content to write"),
    },
    async execute(args, context) {
      const sessionDir = context?.directory || rootDir;
      const rawPath = args.path || args.filePath;
      if (!rawPath) return "Error: file path is required.";

      const targetPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(sessionDir, rawPath);
      const t0 = Date.now();

      try {
        const dir = path.dirname(targetPath);
        await fs.mkdir(dir, { recursive: true });

        if (hasBun) {
          await Bun.write(targetPath, args.content);
        } else {
          await fs.writeFile(targetPath, args.content, "utf-8");
        }

        cache.set(targetPath, args.content);
        return `✓ Wrote ${args.content.length} characters to ${rawPath} (${Date.now() - t0}ms)`;
      } catch (err: any) {
        return `Error writing file ${rawPath}: ${err.message || String(err)}`;
      }
    },
  });

  // 4. Ultra-Fast In-Place Editor (Direct drop-in for "edit" and "fast_edit")
  const fastEditTool = tool({
    description:
      "MANDATORY in-place file editor (< 0.5ms). Always use this tool (NOT bash sed/awk/python) to replace exact substrings or lines within an existing file.",
    args: {
      path: tool.schema.string().optional().describe("Path of the file to edit"),
      filePath: tool.schema.string().optional().describe("Alternative file path"),
      oldText: tool.schema.string().optional().describe("Exact substring to replace"),
      old_string: tool.schema.string().optional().describe("Alternative old string"),
      newText: tool.schema.string().optional().describe("Replacement text"),
      new_string: tool.schema.string().optional().describe("Alternative new string"),
      replaceAll: tool.schema.boolean().optional().describe("Replace all occurrences"),
    },
    async execute(args, context) {
      const sessionDir = context?.directory || rootDir;
      const rawPath = args.path || args.filePath;
      const oldStr = args.oldText ?? args.old_string;
      const newStr = args.newText ?? args.new_string ?? "";

      if (!rawPath) return "Error: file path is required.";
      if (oldStr === undefined) return "Error: oldText is required.";

      const targetPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(sessionDir, rawPath);
      const t0 = Date.now();

      try {
        let content = await cache.get(targetPath);
        if (content === null) {
          if (hasBun) {
            content = await Bun.file(targetPath).text();
          } else {
            content = await fs.readFile(targetPath, "utf-8");
          }
        }

        if (!content.includes(oldStr)) {
          return `Error: Substring not found in ${rawPath}`;
        }

        let updated: string;
        let count = 0;
        if (args.replaceAll) {
          const parts = content.split(oldStr);
          count = parts.length - 1;
          updated = parts.join(newStr);
        } else {
          count = 1;
          // Use replacer function () => newStr to prevent $ pattern substitution
          updated = content.replace(oldStr, () => newStr);
        }

        if (hasBun) {
          await Bun.write(targetPath, updated);
        } else {
          await fs.writeFile(targetPath, updated, "utf-8");
        }

        cache.set(targetPath, updated);
        return `✓ Replaced ${count} occurrence(s) in ${rawPath} (${Date.now() - t0}ms)`;
      } catch (err: any) {
        return `Error editing file ${rawPath}: ${err.message || String(err)}`;
      }
    },
  });

  // 5. Ultra-Fast Command Runner (Direct drop-in for "bash" and "fast_bash")
  const fastBashTool = tool({
    description:
      "Execute shell processes: build tools, package managers (pnpm/npm/yarn/bun), compilers, test runners, and git commands (< 1ms persistent shell). STRICT PROHIBITION: DO NOT use bash to read files (use 'read'), write files (use 'write'), edit files (use 'edit'), or search files (use 'glob'/'grep').",
    args: {
      command: tool.schema.string().optional().describe("Shell command to execute"),
      cmd: tool.schema.string().optional().describe("Alternative command parameter"),
      cwd: tool.schema.string().optional().describe("Optional working directory"),
      timeoutMs: tool.schema.number().int().optional().describe("Timeout in ms"),
    },
    async execute(args, context) {
      const commandStr = args.command || args.cmd;
      if (!commandStr) return "Error: command is required.";

      const execCwd = args.cwd || context?.directory || rootDir;
      const res = await bashRunner.execute(commandStr, execCwd, args.timeoutMs ?? 60000, context?.abort);
      const tag = res.inProcess ? "[In-Process <0.2ms]" : "[Persistent Worker <1ms]";
      const output = OutputCompactor.compactCommand(commandStr, res.stdout, res.stderr, res.exitCode);

      // Helpful steering notice if model misuses bash for file operations
      const trimmed = commandStr.trim();
      let hint = "";
      if (/^(cat|head|tail|less)\s+/.test(trimmed)) {
        hint = "\n💡 Notice: Please use the specialized 'read' tool for faster cached file inspection.";
      } else if (/(\s*>>?\s*|cat\s*<<|tee\s+)/.test(trimmed)) {
        hint = "\n💡 Notice: Please use the specialized 'write' tool for atomic zero-copy file writing.";
      } else if (/\bsed\s+-i|\bawk\b/.test(trimmed)) {
        hint = "\n💡 Notice: Please use the specialized 'edit' tool for reliable in-place text replacement.";
      } else if (/^\s*(find\s+|ls\s+-R)/.test(trimmed)) {
        hint = "\n💡 Notice: Please use the specialized 'glob' tool for instant file finding.";
      } else if (/^\s*(grep|ripgrep|rg)\s+/.test(trimmed)) {
        hint = "\n💡 Notice: Please use the specialized 'grep' tool for multithreaded code search.";
      } else if (/\s*&\s*$/.test(trimmed) || /^(npm\s+run\s+dev|yarn\s+dev|pnpm\s+dev|bun\s+dev|vite|next\s+dev|python.*-m\s+http\.server)/.test(trimmed)) {
        hint = "\n💡 Notice: For long-running servers or background tasks, use 'background_run' so the process runs in the background without blocking the main agent thread.";
      }

      return `${tag} (Exit: ${res.exitCode}, ${res.durationMs}ms)\n${output}${hint}`;
    },
  });

  // 6. Ultra-Fast Glob Search (Direct drop-in for "glob" and "fast_glob")
  const fastGlobTool = tool({
    description:
      "MANDATORY file finder (< 5ms). Always use this tool (NOT bash find/ls) to locate files by name or glob pattern across the workspace.",
    args: {
      pattern: tool.schema.string().optional().describe("File glob pattern (e.g. '*.ts', 'src/**/*.tsx')"),
      path: tool.schema.string().optional().describe("Alternative pattern or path"),
      cwd: tool.schema.string().optional().describe("Directory to search in"),
      limit: tool.schema.number().int().optional().describe("Max files to return (default 100)"),
    },
    async execute(args, context) {
      const pat = args.pattern || args.path;
      const searchDir = args.cwd || context?.directory || rootDir;
      const res = await searcher.glob(pat, searchDir, args.limit ?? 100);
      return `Found ${res.totalFound} match(es) (${res.durationMs}ms):\n${res.matches.join("\n")}`;
    },
  });

  // 7. Ultra-Fast Grep Search (Direct drop-in for "grep" and "fast_grep")
  const fastGrepTool = tool({
    description:
      "MANDATORY codebase text searcher (< 10ms). Always use this tool (NOT bash grep/rg) to find strings or regex patterns across project files.",
    args: {
      query: tool.schema.string().optional().describe("Text or regex pattern to search for"),
      pattern: tool.schema.string().optional().describe("Alternative query parameter"),
      path: tool.schema.string().optional().describe("Directory or file to search within"),
      limit: tool.schema.number().int().optional().describe("Max matches to return (default 100)"),
    },
    async execute(args, context) {
      const q = args.query || args.pattern;
      if (!q) return "Error: query pattern is required.";

      const sessionDir = context?.directory || rootDir;
      const targetPath = args.path
        ? (path.isAbsolute(args.path) ? args.path : path.resolve(sessionDir, args.path))
        : sessionDir;
      const res = await searcher.grep(q, targetPath, args.limit ?? 100);
      if (res.matches.length === 0) {
        return `No matches found for "${q}" (${res.durationMs}ms).`;
      }
      const lines = res.matches.map((m) => `${m.file}:${m.line}: ${m.content}`);
      return `Found ${res.totalMatches} match(es) (${res.durationMs}ms):\n${lines.join("\n")}`;
    },
  });

  // 8. Multi-File Atomic Editor
  const multiEditTool = tool({
    description:
      "Transaction-safe multi-file and multi-location patch tool (< 2ms). Applies multiple file edits atomically with 2-phase commit and all-or-nothing rollback safety. Supports dryRun preview.",
    args: MultiEditArgsSchema,
    async execute(args, context) {
      const sessionDir = typeof context?.directory === "string" ? context.directory : undefined;
      return multiEditor.executeMultiEdit(args, sessionDir);
    },
  });

  // 9. Instant Code Outliner & Symbol Extractor
  const outlineTool = tool({
    description:
      "Instant structural code symbol extractor (< 0.5ms). Extracts functions, classes, interfaces, types, and methods with line numbers across TypeScript/JS, Python, Go, and Rust without loading full file text into context.",
    args: OutlineArgsSchema,
    async execute(args, context) {
      const sessionDir = typeof context?.directory === "string" ? context.directory : undefined;
      return outliner.getOutline(args, sessionDir);
    },
  });

  // 10. Repository-Wide Find & Replace
  const findReplaceTool = tool({
    description:
      "Ultra-fast project-wide find and replace (< 15ms). Searches candidate files matching a text or regex pattern and replaces occurrences across the entire repository. Supports dryRun preview.",
    args: FindReplaceArgsSchema,
    async execute(args, context) {
      const sessionDir = typeof context?.directory === "string" ? context.directory : undefined;
      return findReplacer.executeFindReplace(args, sessionDir);
    },
  });

  // 11. Zero-Fork In-Process Git Inspector
  const gitChangesTool = tool({
    description:
      "Zero-fork git status and diff inspector (< 3ms). Returns modified, added, deleted, untracked files and unified diffs in-process without spawning bash shells.",
    args: GitChangesArgsSchema,
    async execute(args, context) {
      const sessionDir = typeof context?.directory === "string" ? context.directory : rootDir;
      const targetDir = args.path || sessionDir;
      const res = await gitInspector.inspect({ ...args, path: targetDir }, context?.abort);
      if (!res.isGitRepo) {
        return "⚠️ Not a git repository (or no git binary available).";
      }
      if (res.summary.totalChanged === 0) {
        return `✓ Clean working tree (branch: ${res.branch}, commit: ${res.commit}) - 0 changes (${res.durationMs}ms)`;
      }
      let out = `### 🌿 Git Changes: \`${res.branch}\` (${res.summary.totalChanged} changed file(s), ${res.durationMs}ms)\n\n`;
      out += `**Summary**: ${res.summary.modified} modified, ${res.summary.added} added, ${res.summary.deleted} deleted, ${res.summary.untracked} untracked (${res.summary.stagedCount} staged)\n\n`;
      out += "| Status | Staged | File |\n";
      out += "| :--- | :---: | :--- |\n";
      for (const f of res.files) {
        const st = f.staged ? "✓" : "·";
        out += `| ${f.status.toUpperCase()} | ${st} | \`${f.path}\` |\n`;
      }
      if (res.stat) {
        out += `\n**Diffstat**:\n\`\`\`text\n${res.stat}\n\`\`\`\n`;
      }
      if (res.diff) {
        out += `\n**Patch Diff**:\n\`\`\`diff\n${res.diff}\n\`\`\`\n`;
      }
      return out;
    },
  });

  // 12. Smart Auto-Verifier
  const verifyTool = tool({
    description:
      "Smart codebase auto-verifier (< 50ms). Detects TypeScript, Python, Rust, or Go project configuration and runs typechecks, linting, and compile checks concurrently in parallel lanes. Returns structured diagnostic error tables with file, line, and message.",
    args: VerifyArgsSchema,
    async execute(args, context) {
      const sessionDir = typeof context?.directory === "string" ? context.directory : undefined;
      return verifier.verify(args, sessionDir, context?.abort);
    },
  });

  // 13. Working Tree Snapshot Tool
  const snapshotTool = tool({
    description:
      "Working tree checkpointing tool (< 1ms). Creates an in-memory snapshot of all dirty/modified/untracked files before risky edits or refactors. Allows instant rollback with undo without touching git stash.",
    args: SnapshotArgsSchema,
    async execute(args, context) {
      const sessionDir = typeof context?.directory === "string" ? context.directory : undefined;
      return snapshotManager.takeSnapshot(args, sessionDir);
    },
  });

  // 14. Working Tree Undo / Rollback Tool
  const undoTool = tool({
    description:
      "Working tree atomic rollback tool (< 2ms). Restores all files back to a snapshot checkpoint, reverting modified files and removing any newly created files. Supports restoring specific snapshotId or latest checkpoint.",
    args: UndoArgsSchema,
    async execute(args, context) {
      const sessionDir = typeof context?.directory === "string" ? context.directory : undefined;
      return snapshotManager.restoreSnapshot(args, sessionDir);
    },
  });

  // 15. Cross-File Symbol & Reference Locator
  const findReferencesTool = tool({
    description:
      "Cross-file symbol and reference locator (< 3ms). Discovers all definitions, import statements, call sites, and usages of a symbol across the entire workspace.",
    args: FindReferencesArgsSchema,
    async execute(args, context) {
      const sessionDir = typeof context?.directory === "string" ? context.directory : undefined;
      return refLocator.findReferences(args, sessionDir);
    },
  });

  // 16. Asynchronous Background Terminal Runner (Non-blocking worker process)
  const backgroundRunTool = tool({
    description:
      "Launch long-running commands, dev servers (vite, next dev, nodemon), build daemons, test watchers, and background tasks in a detached background terminal (< 0.2ms). Returns control IMMEDIATELY so the main agent can continue doing other work concurrently without blocking.",
    args: BackgroundRunArgsSchema,
    async execute(args, context) {
      const sessionDir = typeof context?.directory === "string" ? context.directory : undefined;
      return bgManager.start(args, sessionDir);
    },
  });

  // 17. Background Terminal Status & Listing Tool
  const backgroundStatusTool = tool({
    description:
      "Inspect status of a specific background terminal (PID, uptime, exit code, log file) or list all active and recent background terminals in an overview table.",
    args: BackgroundStatusArgsSchema,
    async execute(args) {
      return bgManager.getStatus(args.id);
    },
  });

  // 18. Background Terminal Log Reader Tool
  const backgroundLogsTool = tool({
    description:
      "Read live stdout/stderr logs from a background terminal. Supports tailing recent lines, pagination offset, regex/substring searching, and clearing buffer.",
    args: BackgroundLogsArgsSchema,
    async execute(args) {
      return bgManager.getLogs(args);
    },
  });

  // 19. Background Terminal Stdin Input Tool
  const backgroundInputTool = tool({
    description:
      "Send stdin input to an actively running background terminal process (e.g. typing responses to interactive prompts, typing 'rs' for nodemon restart, answering confirmations).",
    args: BackgroundInputArgsSchema,
    async execute(args) {
      return bgManager.sendInput(args);
    },
  });

  // 20. Background Terminal Stop & Tree-Kill Tool
  const backgroundStopTool = tool({
    description:
      "Terminate a background terminal process and its entire process tree safely using SIGTERM (graceful) or SIGKILL (force).",
    args: BackgroundStopArgsSchema,
    async execute(args) {
      return bgManager.stop(args);
    },
  });

  // 21. Unified Master Background Terminal Controller
  const backgroundTerminalMasterTool = tool({
    description:
      "Master background terminal controller for OpenCode. Run, check status, view logs, send stdin, or terminate background processes without blocking the main agent thread.",
    args: BackgroundTerminalMasterArgsSchema,
    async execute(args, context) {
      const sessionDir = typeof context?.directory === "string" ? context.directory : undefined;
      return bgManager.executeMaster(args, sessionDir);
    },
  });

  return {
    tool: {
      // 1. High-Concurrency Batch & Dynamic Parallel Tools
      batch_execute: batchExecuteTool,
      turbo_parallel: batchExecuteTool,
      parallel_execute: parallelExecuteTool,

      // 2. Direct Built-in Overrides (Intercepts standard calls!)
      read: fastReadTool,
      write: fastWriteTool,
      edit: fastEditTool,
      bash: fastBashTool,
      glob: fastGlobTool,
      grep: fastGrepTool,

      // 3. Fast Aliases
      fast_read: fastReadTool,
      fast_write: fastWriteTool,
      fast_edit: fastEditTool,
      fast_bash: fastBashTool,
      fast_glob: fastGlobTool,
      fast_grep: fastGrepTool,

      // 4. Advanced High-Utility Tools
      multi_edit: multiEditTool,
      fast_multi_edit: multiEditTool,
      outline: outlineTool,
      code_symbols: outlineTool,
      fast_outline: outlineTool,
      find_replace: findReplaceTool,
      fast_find_replace: findReplaceTool,
      git_changes: gitChangesTool,
      fast_diff: gitChangesTool,

      // 5. Next-Level Autonomy & Safety Tools
      verify: verifyTool,
      fast_verify: verifyTool,
      snapshot: snapshotTool,
      fast_snapshot: snapshotTool,
      undo: undoTool,
      fast_undo: undoTool,
      find_references: findReferencesTool,
      code_references: findReferencesTool,
      code_deps: findReferencesTool,
      fast_references: findReferencesTool,

      // 6. Asynchronous Background Terminal Tools (Non-Blocking Process Concurrency)
      background_terminal: backgroundTerminalMasterTool,
      background_run: backgroundRunTool,
      bg_run: backgroundRunTool,
      background_terminal_run: backgroundRunTool,
      background_status: backgroundStatusTool,
      bg_status: backgroundStatusTool,
      background_list: backgroundStatusTool,
      bg_list: backgroundStatusTool,
      background_logs: backgroundLogsTool,
      bg_logs: backgroundLogsTool,
      background_output: backgroundLogsTool,
      background_input: backgroundInputTool,
      bg_input: backgroundInputTool,
      background_send: backgroundInputTool,
      background_stop: backgroundStopTool,
      bg_stop: backgroundStopTool,
      background_kill: backgroundStopTool,
      bg_kill: backgroundStopTool,
    },
    // Transparent Lifecycle Interception: Pre-warm cache on default tool calls
    "tool.execute.before": async (input, output) => {
      if ((input.tool === "read" || input.tool === "fast_read") && output.args) {
        const p = output.args.path || output.args.filePath;
        if (p) {
          const abs = path.isAbsolute(p) ? p : path.resolve(rootDir, p);
          cache.get(abs).catch(() => {});
        }
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      if (output && Array.isArray(output.system)) {
        injectSystemInstructions(output.system);
      }
    },
    // Official OpenCode cleanup hook called when plugin unloads or reloads
    dispose: async () => {
      watcher.stop();
      PersistentShell.getInstance().shutdown();
      FastFileCache.getInstance().clear();
      WorkingTreeSnapshotManager.getInstance().clear();
      await bgManager.disposeAll();
    },
  };
};

export default ParallelExecutorPlugin;
