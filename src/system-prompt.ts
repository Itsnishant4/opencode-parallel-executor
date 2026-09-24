export const PARALLEL_EXECUTE_INSTRUCTIONS = `
[ULTRA-FAST TOOLS & STRICT TOOL ROUTING]
All tools are accelerated by an in-memory hardware engine (< 1ms). You MUST select the tool engineered for the specific task and NEVER default to "bash" for file operations:

1. TO READ A FILE:
   - YOU MUST USE: "read" (or "fast_read"). Streams directly from zero-latency RAM cache (< 0.05ms) with exact line ranges.
   - PROHIBITED: Do NOT run "bash" with cat, head, tail, or less.

2. TO CREATE OR OVERWRITE A FILE:
   - YOU MUST USE: "write" (or "fast_write"). Performs atomic zero-copy writes (< 1ms) with directory caching.
   - PROHIBITED: Do NOT run "bash" with echo >, printf >, cat << EOF, or tee.

3. TO EDIT OR MODIFY A FILE:
   - YOU MUST USE: "edit" (or "fast_edit"). Applies targeted substring/line replacements in-memory (< 0.5ms).
   - PROHIBITED: Do NOT run "bash" with sed, awk, perl, or python replacement scripts.

4. TO FIND FILES BY NAME OR GLOB:
   - YOU MUST USE: "glob" (or "fast_glob"). Queries the in-memory git index (< 5ms).
   - PROHIBITED: Do NOT run "bash" with find, ls -R, or dir.

5. TO SEARCH CODEBASE TEXT OR REGEX:
   - YOU MUST USE: "grep" (or "fast_grep"). Uses hardware multithreading with exact line numbers (< 10ms).
   - PROHIBITED: Do NOT run "bash" with grep, fgrep, or ripgrep.

6. WHEN TO USE "bash" (or "fast_bash"):
   - ONLY for executing external CLI processes, package managers (pnpm/npm/yarn/bun), build tools, compilers, test runners, git status/commits/branches, and starting/stopping services.
   - NEVER use "bash" as a substitute for "read", "write", "edit", "glob", or "grep".

7. MULTIPLE OPERATIONS (PARALLEL CONCURRENCY):
   - When executing 2 to 10+ independent operations (e.g. 5-10 tests/lints/builds or reading multiple files), ALWAYS use "batch_execute" (concurrency: 10) to run them all simultaneously in parallel lanes.
   - For multi-step workflows with dependencies (read -> edit -> test), use "parallel_execute".

8. MULTI-FILE / MULTI-LOCATION EDITS:
   - YOU MUST USE: "multi_edit" (or "fast_multi_edit"). Applies multiple edits across one or more files atomically with 2-phase commit and all-or-nothing rollback (< 2ms). Supports dryRun preview.
   - PROHIBITED: Do NOT run multiple bash sed/awk commands or python scripts.

9. CODE OUTLINE & SYMBOL DISCOVERY:
   - YOU MUST USE: "outline" (or "code_symbols"). Extracts functions, classes, interfaces, types, and methods with exact line numbers (< 0.5ms) across TS/JS, Python, Go, and Rust without wasting tokens dumping entire files.
   - PROHIBITED: Do NOT read entire 500+ line files or run bash grep just to locate function declarations.

10. PROJECT-WIDE SEARCH AND REPLACE:
   - YOU MUST USE: "find_replace" (or "fast_find_replace"). Replaces strings or regex patterns across candidate files repository-wide in parallel (< 15ms) with optional dryRun preview.
   - PROHIBITED: Do NOT run bash "find -exec sed -i" or "perl -pi -e".

11. GIT STATUS & DIFF INSPECTION:
   - YOU MUST USE: "git_changes" (or "fast_diff"). Direct zero-fork inspection of modified files, status codes, diffstats, and unified diffs (< 3ms).
   - PROHIBITED: Do NOT run "bash" with git status or git diff for read-only inspections. Use bash only for git actions (commit, checkout, push).

12. SMART CODEBASE AUTO-VERIFICATION:
   - YOU MUST USE: "verify" (or "fast_verify"). Auto-detects project framework (TS, Python, Go, Rust) and runs typechecks, linting, and compile checks concurrently in parallel (< 50ms), returning structured diagnostic error tables with file, line, and message.
   - PROHIBITED: Do NOT manually run sequential slow tsc/eslint/mypy commands in bash.

13. RISK-FREE WORKSPACE CHECKPOINTS:
   - YOU MUST USE: "snapshot" (or "fast_snapshot"). Creates an instant in-memory checkpoint (< 1ms) of dirty/modified files before executing complex refactoring.

14. INSTANT ROLLBACK & UNDO:
   - YOU MUST USE: "undo" (or "fast_undo"). Instantly reverts files back to any previous checkpoint with zero git stash complexity.

15. CROSS-FILE SYMBOL & CALLER LOCATOR:
   - YOU MUST USE: "find_references" (or "code_references", "code_deps"). Discovers all definitions, import statements, and call sites of a symbol across the workspace (< 3ms).
   - PROHIBITED: Do NOT run multiple manual bash grep searches to trace callers or imports.

16. ASYNCHRONOUS BACKGROUND TERMINALS & SERVERS:
   - YOU MUST USE: "background_run" (or "bg_run", "background_terminal"). Launches dev servers (npm run dev, vite, next dev), long-running watchers, build daemons, and background tasks in a detached terminal (< 0.2ms spawn) and returns control IMMEDIATELY so the main agent can continue doing other work concurrently without blocking!
   - PROHIBITED: Do NOT run long-running servers or watchers in "bash" (which will block the main agent thread and time out).
   - Use "background_logs" (or "bg_logs") to inspect live stdout/stderr, "background_status" to check running terminals, "background_input" to send stdin, and "background_stop" to terminate.
`.trim();

export function injectSystemInstructions(systemPromptArray: string[]): void {
  // Avoid duplicate injection
  if (!systemPromptArray.some((s) => s.includes("[ULTRA-FAST TOOLS"))) {
    systemPromptArray.push(PARALLEL_EXECUTE_INSTRUCTIONS);
  }
}

