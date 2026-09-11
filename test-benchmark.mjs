import path from "node:path";
import { performance } from "node:perf_hooks";
import { FastFileCache } from "./dist/fast-cache.js";
import { FastWatcher } from "./dist/fast-watcher.js";
import { PersistentShell } from "./dist/persistent-shell.js";
import { FastBashRunner } from "./dist/fast-bash.js";
import { OutputCompactor } from "./dist/compact-output.js";
import { TaskExecutor } from "./dist/executor.js";

const rootDir = process.cwd();

console.log("=================================================");
console.log("🚀 ULTRA-FAST OPENCODE ENGINE PERFORMANCE BENCHMARK");
console.log("=================================================");

async function runBenchmarks() {
  // 1. PersistentShell Benchmark
  console.log("\n--- [1] PersistentShell vs Subprocess Spawn ---");
  const shell = PersistentShell.getInstance();

  const t0Spawn = performance.now();
  const { spawn } = await import("node:child_process");
  for (let i = 0; i < 10; i++) {
    await new Promise((res) => {
      const p = spawn("/bin/sh", ["-c", "echo test"]);
      p.on("close", res);
    });
  }
  const spawnDuration = performance.now() - t0Spawn;

  const t0Persist = performance.now();
  for (let i = 0; i < 10; i++) {
    await shell.execute("echo test", rootDir);
  }
  const persistDuration = performance.now() - t0Persist;

  console.log(`10 x Standard spawn("/bin/sh"): ${spawnDuration.toFixed(2)}ms (avg: ${(spawnDuration / 10).toFixed(2)}ms/cmd)`);
  console.log(`10 x PersistentShell:          ${persistDuration.toFixed(2)}ms (avg: ${(persistDuration / 10).toFixed(2)}ms/cmd)`);
  console.log(`⚡ Speedup: ${(spawnDuration / persistDuration).toFixed(1)}x faster!`);

  // 2. FastBashRunner (In-Process vs Shell)
  console.log("\n--- [2] FastBashRunner Micro-Execution ---");
  const bashRunner = new FastBashRunner(rootDir);

  const t0InProc = performance.now();
  const pwdRes = await bashRunner.execute("pwd");
  const echoRes = await bashRunner.execute("echo 'ultra fast'");
  const lsRes = await bashRunner.execute("ls src");
  const inProcDuration = performance.now() - t0InProc;

  console.log(`pwd (in-process: ${pwdRes.inProcess}):  ${pwdRes.durationMs}ms`);
  console.log(`echo (in-process: ${echoRes.inProcess}): ${echoRes.durationMs}ms`);
  console.log(`ls (in-process: ${lsRes.inProcess}):   ${lsRes.durationMs}ms`);
  console.log(`3 in-process commands executed in:     ${inProcDuration.toFixed(2)}ms total!`);

  // 3. FastWatcher & Pre-warmed RAM Cache
  console.log("\n--- [3] Background RAM Pre-Warming & Zero-Stat Reads ---");
  const cache = FastFileCache.getInstance();
  const watcher = FastWatcher.getInstance(rootDir);
  watcher.start();

  // Wait 100ms for background pre-warm
  await new Promise((r) => setTimeout(r, 150));
  const status = watcher.getStatus();
  console.log(`Watcher active: ${status.isWatching}, Pre-warmed files: ${status.prewarmedCount}, Cache size: ${cache.getCachedSize()}`);

  const targetFile = path.resolve(rootDir, "package.json");
  const t0Read = performance.now();
  const readCount = 1000;
  for (let i = 0; i < readCount; i++) {
    await cache.get(targetFile);
  }
  const readDuration = performance.now() - t0Read;
  console.log(`${readCount} RAM cache reads: ${readDuration.toFixed(2)}ms (avg: ${(readDuration / readCount * 1000).toFixed(2)}µs per read)`);

  // 4. Output Compactor Token Reduction
  console.log("\n--- [4] Output Compactor Token Reduction ---");
  const verboseOutput = Array.from({ length: 200 }, (_, i) => `[build log info line ${i}] Compiling chunk ${i}...`).join("\n") +
    "\n\n==================== 42 tests passed ====================\nDone in 1.4s\n";
  const compactedCmd = OutputCompactor.compactCommand("npm test", verboseOutput, "", 0);

  console.log(`Original verbose log length: ${verboseOutput.length} chars (~${Math.round(verboseOutput.length / 4)} tokens)`);
  console.log(`Compacted log length:        ${compactedCmd.length} chars (~${Math.round(compactedCmd.length / 4)} tokens)`);
  console.log(`⚡ Token reduction:           ${Math.round((1 - compactedCmd.length / verboseOutput.length) * 100)}% reduction!`);
  console.log(`Preview of compacted:\n${compactedCmd}`);

  // 5. TaskExecutor Continuous DAG
  console.log("\n--- [5] TaskExecutor Continuous Dynamic DAG ---");
  const executor = new TaskExecutor(rootDir);
  const dagOps = [
    { id: "read-pkg", type: "read", path: "package.json", dependsOn: [] },
    { id: "read-src", type: "read", path: "src/index.ts", lines: "1-30", dependsOn: [] },
    { id: "cmd-git", type: "command", command: "git branch --show-current", dependsOn: [] },
    { id: "cmd-echo", type: "command", command: "echo 'DAG done'", dependsOn: ["read-pkg", "cmd-git"] },
  ];

  const t0Dag = performance.now();
  const dagResult = await executor.executeContinuousDAG(dagOps);
  const dagDuration = performance.now() - t0Dag;

  console.log(`Executed ${dagResult.summary.total} tasks across ${dagResult.summary.stagesExecuted} stages in ${dagDuration.toFixed(2)}ms!`);
  console.log(`Succeeded: ${dagResult.summary.succeeded}, Failed: ${dagResult.summary.failed}`);

  // Cleanup
  watcher.stop();
  shell.shutdown();

  console.log("\n=================================================");
  console.log("✅ ALL ULTRA-FAST ENGINE BENCHMARKS COMPLETED!");
  console.log("=================================================");
}

runBenchmarks().catch(console.error);
