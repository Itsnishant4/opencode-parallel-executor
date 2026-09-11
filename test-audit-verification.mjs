import { performance } from "node:perf_hooks";
import path from "node:path";
import fs from "node:fs/promises";
import { PersistentShell } from "./dist/persistent-shell.js";
import { FastFileCache } from "./dist/fast-cache.js";
import { FastBashRunner } from "./dist/fast-bash.js";
import { BatchExecutor } from "./dist/batch-tool.js";
import { OutputCompactor } from "./dist/compact-output.js";

const rootDir = process.cwd();

console.log("=================================================");
console.log("🛡️ AUDIT & BUG-FIX VERIFICATION TEST SUITE");
console.log("=================================================");

async function runAuditTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${message}`);
      failed++;
    }
  }

  // 1. OutputCompactor ANSI stripping
  console.log("\n[Test 1] OutputCompactor ANSI Escape Code Stripping");
  const ansiText = "\u001b[32mPASS\u001b[39m \u001b[1mtests/auth.test.ts\u001b[22m";
  const stripped = OutputCompactor.stripAnsi(ansiText);
  assert(stripped === "PASS tests/auth.test.ts", "Strips ANSI color codes completely");

  // 2. FastFileCache out-of-bounds line range handling
  console.log("\n[Test 2] FastFileCache Out-of-Bounds Line Range Handling");
  const cache = FastFileCache.getInstance();
  const rangeRes = await cache.getLines(path.resolve(rootDir, "package.json"), 9999, 10000);
  assert(rangeRes !== null, "Returns result object for out-of-bounds line range");
  assert(rangeRes.linesRead === 0, "Correctly returns 0 linesRead");
  assert(rangeRes.content.includes("(no lines in this range)"), "Contains '(no lines in this range)' indicator");

  // 3. FastBashRunner in-process quote stripping
  console.log("\n[Test 3] FastBashRunner In-Process Arguments with Quotes");
  const bash = new FastBashRunner(rootDir);
  const echoRes = await bash.execute('echo "first" "second"');
  assert(echoRes.inProcess === true, "echo is evaluated in-process");
  assert(echoRes.stdout === "first second", "echo preserves words and strips quotes properly");

  const catRes = await bash.execute('cat "package.json"');
  assert(catRes.inProcess === true, "cat with quoted path evaluates in-process");
  assert(catRes.stdout.includes('"name":'), "cat reads file content correctly");

  const lsRes = await bash.execute('ls "src"');
  assert(lsRes.inProcess === true, "ls with quoted path evaluates in-process");
  assert(lsRes.stdout.includes("index.ts"), "ls lists directory correctly");

  // 4. BatchExecutor failFast marks skipped tasks
  console.log("\n[Test 4] BatchExecutor failFast Skipped Tasks Accounting");
  const batch = new BatchExecutor(rootDir);
  const failFastRes = await batch.runBatch({
    concurrency: 1,
    failFast: true,
    commands: [
      "exit 1", // task 1 fails immediately
      "echo 'Task 2'",
      "echo 'Task 3'",
      "echo 'Task 4'",
    ],
  });
  assert(failFastRes.includes("❌ Fail"), "Records failing task");
  assert(failFastRes.includes("⏭️ Skip"), "Unexecuted tasks are properly recorded as Skip");

  // 5. PersistentShell worker queue burst and graceful shutdown
  console.log("\n[Test 5] PersistentShell High-Volume Queue Burst (15 Commands across 12 Workers)");
  const shell = PersistentShell.getInstance();
  const t0 = performance.now();
  const promises = Array.from({ length: 15 }, (_, i) =>
    shell.execute(`echo "burst job ${i + 1}"`, rootDir)
  );
  const burstResults = await Promise.all(promises);
  const dur = performance.now() - t0;
  assert(burstResults.length === 15, "All 15 queued commands completed");
  assert(burstResults.every((r) => r.exitCode === 0), "All 15 commands succeeded with exit code 0");
  console.log(`  ⚡ 15 queued shell commands executed in ${dur.toFixed(2)}ms!`);

  shell.shutdown();

  console.log("\n=================================================");
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("=================================================");

  if (failed > 0) process.exit(1);
}

runAuditTests().catch((err) => {
  console.error("Audit test crashed:", err);
  process.exit(1);
});
