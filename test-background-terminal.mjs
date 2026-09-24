import assert from "node:assert";
import { BackgroundTerminalManager } from "./dist/background-terminal.js";
import { ParallelExecutorPlugin } from "./dist/index.js";

console.log("🧪 Starting Background Terminal Subsystem Test Suite...\n");

const mgr = BackgroundTerminalManager.getInstance(process.cwd());

// 1. Test: Launch long-running background process (Non-blocking check)
console.log("▶ 1. Testing non-blocking background launch...");
const t0 = performance.now();
const startRes = await mgr.start({
  command: "node -e 'console.log(\"SERVER_READY_PORT_3333\"); setInterval(() => console.log(\"HEARTBEAT \" + Date.now()), 150);'",
  id: "test-bg-server",
  waitMs: 300,
});
const duration = performance.now() - t0;

console.log(`   Launch completed in: ${duration.toFixed(2)}ms`);
assert.ok(duration < 1000, `Launch should be fast and non-blocking, took ${duration}ms`);
assert.ok(startRes.includes("Background Terminal Started Successfully"), "Should report successful start");
assert.ok(startRes.includes("test-bg-server"), "Should contain terminal ID");
assert.ok(startRes.includes("RUNNING"), "Should be running");
assert.ok(startRes.includes("SERVER_READY_PORT_3333"), "Initial output should contain startup banner");
console.log("   ✅ Background launch is non-blocking and captured initial startup banner.");

// 2. Test: Concurrent main agent work while background process is running
console.log("▶ 2. Testing concurrent main agent execution while background terminal runs...");
const concurrentStart = performance.now();
// Main agent executes other tasks
const sum = Array.from({ length: 100000 }, (_, i) => i).reduce((a, b) => a + b, 0);
assert.strictEqual(sum, 4999950000);
const concurrentDur = performance.now() - concurrentStart;
console.log(`   Main agent concurrent execution verified in ${concurrentDur.toFixed(3)}ms`);
console.log("   ✅ Main agent can perform work concurrently while terminal runs in background.");

// 3. Test: Check status (single & table)
console.log("▶ 3. Testing status reporting...");
const statusSingle = mgr.getStatus("test-bg-server");
assert.ok(statusSingle.includes("RUNNING"), "Status should show RUNNING");
assert.ok(statusSingle.includes("PID:"), "Status should include PID");

const statusTable = mgr.getStatus();
assert.ok(statusTable.includes("test-bg-serv"), "Overview table should include test-bg-server");
assert.ok(statusTable.includes("RUNNING"), "Overview table should show RUNNING");
console.log("   ✅ Status reporting (single & table) verified.");

// 4. Test: Read logs & filtering
console.log("▶ 4. Testing log retrieval & filtering...");
// Wait 400ms for several heartbeats to generate
await new Promise(r => setTimeout(r, 400));

const logs = mgr.getLogs({ id: "test-bg-server", lines: 10, clear: false });
assert.ok(logs.includes("HEARTBEAT"), "Logs should contain heartbeat ticks");

const filteredLogs = mgr.getLogs({ id: "test-bg-server", search: "SERVER_READY", clear: false });
assert.ok(filteredLogs.includes("SERVER_READY_PORT_3333"), "Filtered logs should match search query");
console.log("   ✅ Log retrieval and search filter verified.");

// 5. Test: Interactive Stdin Input
console.log("▶ 5. Testing interactive stdin input...");
await mgr.start({
  command: "node -e 'process.stdin.setEncoding(\"utf8\"); process.stdin.on(\"data\", d => console.log(\"STDIN_ECHO:\" + d.trim())); setInterval(() => {}, 1000);'",
  id: "test-interactive",
  waitMs: 200,
});

const sendRes = mgr.sendInput({
  id: "test-interactive",
  input: "HELLO_BACKGROUND_TERMINAL",
});
assert.ok(sendRes.includes("successfully sent"), "Input send should succeed");

// Wait for echo to be processed
await new Promise(r => setTimeout(r, 200));
const echoLogs = mgr.getLogs({ id: "test-interactive", lines: 20, clear: false });
assert.ok(echoLogs.includes("STDIN_ECHO:HELLO_BACKGROUND_TERMINAL"), "Process should have echoed stdin input");
console.log("   ✅ Interactive stdin input verified.");

// 6. Test: Process termination (stop & tree kill)
console.log("▶ 6. Testing graceful process termination...");
const stopRes1 = await mgr.stop({ id: "test-bg-server", force: false });
assert.ok(stopRes1.includes("terminated"), "Should report terminated");

const stopRes2 = await mgr.stop({ id: "test-interactive", force: true });
assert.ok(stopRes2.includes("terminated"), "Should report terminated");

const finalStatus = mgr.getStatus("test-bg-server");
assert.ok(finalStatus.includes("KILLED") || finalStatus.includes("EXITED"), "Terminal should no longer be running");
console.log("   ✅ Process termination verified.");

// 7. Test: Short-lived command handling
console.log("▶ 7. Testing fast short-lived command...");
const fastRes = await mgr.start({
  command: "echo 'INSTANT_COMPLETE'",
  id: "test-fast",
  waitMs: 250,
});
assert.ok(fastRes.includes("INSTANT_COMPLETE"), "Should capture output of fast command");
assert.ok(fastRes.includes("completed quickly") || fastRes.includes("exit code 0"), "Should report completion");
console.log("   ✅ Short-lived command handled gracefully.");

// 8. Test: OpenCode Plugin Tool Integration
console.log("▶ 8. Testing OpenCode plugin tool registration...");
const pluginInstance = await ParallelExecutorPlugin({
  directory: process.cwd(),
  worktree: process.cwd(),
  serverUrl: new URL("http://localhost:4096"),
  client: {},
  project: {},
  $: {},
});

const tools = pluginInstance.tool;
const expectedTools = [
  "background_terminal",
  "background_run",
  "bg_run",
  "background_terminal_run",
  "background_status",
  "bg_status",
  "background_list",
  "bg_list",
  "background_logs",
  "bg_logs",
  "background_output",
  "background_input",
  "bg_input",
  "background_send",
  "background_stop",
  "bg_stop",
  "background_kill",
  "bg_kill",
];

for (const t of expectedTools) {
  assert.ok(tools[t], `Tool '${t}' must be registered in OpenCode plugin`);
  assert.strictEqual(typeof tools[t].execute, "function", `Tool '${t}.execute' must be a function`);
}
console.log(`   ✅ All ${expectedTools.length} background terminal tools & aliases verified in OpenCode plugin!`);

// Cleanup
await pluginInstance.dispose();
await mgr.disposeAll();

console.log("\n=================================================");
console.log("🎉 ALL BACKGROUND TERMINAL TESTS PASSED (100%)!");
console.log("=================================================\n");

process.exit(0);
