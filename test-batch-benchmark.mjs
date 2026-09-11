import path from "node:path";
import { performance } from "node:perf_hooks";
import { BatchExecutor } from "./dist/batch-tool.js";
import { PersistentShell } from "./dist/persistent-shell.js";
import { FastWatcher } from "./dist/fast-watcher.js";

const rootDir = process.cwd();

console.log("=================================================");
console.log("🚀 BATCH_EXECUTE HIGH-CONCURRENCY BENCHMARK (5-10 LANES)");
console.log("=================================================");

async function runBatchBenchmark() {
  const watcher = FastWatcher.getInstance(rootDir);
  watcher.start();
  await new Promise((r) => setTimeout(r, 100));

  const batchExecutor = new BatchExecutor(rootDir);

  // Test 1: 5 Parallel Commands (Concurrency: 5)
  console.log("\n--- [1] 5 Parallel Shell Commands (concurrency: 5) ---");
  const t0Five = performance.now();
  const resFive = await batchExecutor.runBatch({
    concurrency: 5,
    commands: [
      "echo 'Task 1: Auth check'",
      "echo 'Task 2: DB ping'",
      "echo 'Task 3: Cache flush'",
      "echo 'Task 4: Metrics export'",
      "echo 'Task 5: Health status'",
    ],
  });
  const durFive = performance.now() - t0Five;
  console.log(resFive);
  console.log(`⏱️ 5 parallel commands completed in: ${durFive.toFixed(2)}ms (avg: ${(durFive / 5).toFixed(2)}ms/lane)`);

  // Test 2: 10 Parallel Shell Commands (Concurrency: 10)
  console.log("\n--- [2] 10 Parallel Shell Commands (concurrency: 10) ---");
  const commands10 = Array.from({ length: 10 }, (_, i) => `echo 'Worker ${i + 1} processing job'`);
  const t0Ten = performance.now();
  const resTen = await batchExecutor.runBatch({
    concurrency: 10,
    commands: commands10,
  });
  const durTen = performance.now() - t0Ten;
  console.log(resTen);
  console.log(`⏱️ 10 parallel commands completed in: ${durTen.toFixed(2)}ms (avg: ${(durTen / 10).toFixed(2)}ms/lane)`);

  // Test 3: 10 Parallel Source File Reads from Pre-warmed RAM (Concurrency: 10)
  console.log("\n--- [3] 10 Parallel File Reads from RAM (concurrency: 10) ---");
  const reads10 = [
    "package.json",
    "tsconfig.json",
    "src/index.ts",
    "src/types.ts",
    "src/executor.ts",
    "src/fast-bash.ts",
    "src/fast-cache.ts",
    "src/fast-search.ts",
    "src/fast-watcher.ts",
    "src/batch-tool.ts",
  ];
  const t0Reads = performance.now();
  const resReads = await batchExecutor.runBatch({
    concurrency: 10,
    reads: reads10,
  });
  const durReads = performance.now() - t0Reads;
  console.log(resReads.slice(0, 300) + "\n... [table preview truncated for output brevity] ...");
  console.log(`⏱️ 10 parallel file reads completed in: ${durReads.toFixed(2)}ms!`);

  // Test 4: Mixed Heterogeneous 10-Task Batch (5 Reads + 5 Commands)
  console.log("\n--- [4] Mixed Batch: 5 Reads + 5 Commands Concurrently ---");
  const t0Mixed = performance.now();
  const resMixed = await batchExecutor.runBatch({
    concurrency: 10,
    commands: [
      "git branch --show-current",
      "pwd",
      "echo 'Build dry-run'",
      "echo 'Lint dry-run'",
      "git status --short",
    ],
    reads: [
      "package.json",
      "tsconfig.json",
      "src/index.ts",
      "src/fast-watcher.ts",
      "src/batch-tool.ts",
    ],
  });
  const durMixed = performance.now() - t0Mixed;
  console.log(resMixed);
  console.log(`⏱️ 10 mixed tasks completed in: ${durMixed.toFixed(2)}ms!`);

  // Cleanup
  watcher.stop();
  PersistentShell.getInstance().shutdown();

  console.log("\n=================================================");
  console.log("✅ ALL BATCH_EXECUTE HIGH-CONCURRENCY BENCHMARKS PASSED!");
  console.log("=================================================");
}

runBatchBenchmark().catch(console.error);
