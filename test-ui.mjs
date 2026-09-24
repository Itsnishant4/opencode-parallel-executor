import assert from "node:assert";
import { TerminalUI } from "./dist/ui/terminal-ui.js";
import { WebDashboardServer } from "./dist/ui/web-dashboard.js";
import { ParallelExecutorPlugin } from "./dist/index.js";

console.log("🧪 Starting Terminal & Web/Desktop UI Test Suite...\n");

// 1. Test: Terminal UI Banner & Dashboard Rendering
console.log("▶ 1. Testing Terminal TUI banner and dashboard rendering...");
const banner = TerminalUI.renderBanner();
assert.ok(banner.includes("OPENCODE PARALLEL EXECUTOR"), "Banner must contain project title");
assert.ok(banner.includes("v1.1.0"), "Banner must contain version number");

const dashboardTui = TerminalUI.renderDashboard(process.cwd());
assert.ok(dashboardTui.includes("SYSTEM & ENGINE METRICS"), "Dashboard must include System Metrics");
assert.ok(dashboardTui.includes("In-Memory RAM Cache:"), "Dashboard must show RAM cache status");
assert.ok(dashboardTui.includes("ACTIVE & RECENT BACKGROUND TERMINALS"), "Dashboard must show Background Terminals table");
assert.ok(dashboardTui.includes("QUICK COMMANDS & SHORTCUTS"), "Dashboard must include command navigator");
console.log("   ✅ Terminal TUI rendering verified!");

// 2. Test: Web & Desktop Dashboard Server
console.log("▶ 2. Testing Web & Desktop Dashboard Server on local HTTP port...");
const webServer = WebDashboardServer.getInstance(process.cwd());
const { url, port } = await webServer.start(20888);
console.log(`   Web Dashboard listening on: ${url}`);
assert.ok(port >= 20888, "Port should be >= 20888");

// Fetch Root HTML
const htmlRes = await fetch(`${url}/`);
assert.strictEqual(htmlRes.status, 200, "Root should return 200 OK");
const htmlText = await htmlRes.text();
assert.ok(htmlText.includes("OpenCode Parallel Executor"), "HTML must contain title");
assert.ok(htmlText.includes("Background Terminals"), "HTML must contain Background Terminals tab");
assert.ok(htmlText.includes("tailwind"), "HTML must include Tailwind CSS");
console.log("   ✅ HTML Dashboard rendered and served successfully!");

// 3. Test: REST API Endpoints (/api/status, /api/run, /api/logs, /api/stop)
console.log("▶ 3. Testing Dashboard REST APIs...");
const statusRes = await fetch(`${url}/api/status`);
assert.strictEqual(statusRes.status, 200);
const statusData = await statusRes.json();
assert.ok(Array.isArray(statusData.terminals), "Status must return terminals array");
assert.ok(statusData.cacheStats, "Status must return cache stats");

// Test POST /api/run
const runRes = await fetch(`${url}/api/run`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    command: "node -e 'console.log(\"WEB_API_TEST_OK\"); setInterval(() => console.log(\"PING\"), 100);'",
    id: "test-web-terminal",
    waitMs: 250,
  }),
});
assert.strictEqual(runRes.status, 200);
const runJson = await runRes.json();
assert.strictEqual(runJson.ok, true, "Launch via API should succeed");

// Wait 300ms for logs
await new Promise(r => setTimeout(r, 300));

// Test GET /api/logs
const logsRes = await fetch(`${url}/api/logs?id=test-web-terminal&lines=20`);
assert.strictEqual(logsRes.status, 200);
const logsJson = await logsRes.json();
assert.ok(logsJson.lines.some(l => l.includes("WEB_API_TEST_OK") || l.includes("PING")), "Logs should return process output");

// Test POST /api/stop
const stopRes = await fetch(`${url}/api/stop`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "test-web-terminal", force: true }),
});
assert.strictEqual(stopRes.status, 200);
const stopJson = await stopRes.json();
assert.strictEqual(stopJson.ok, true, "Stop via API should succeed");

// Stop Web Server
await webServer.stop();
console.log("   ✅ Dashboard REST APIs verified!");

// 4. Test: OpenCode Plugin Tool Registrations
console.log("▶ 4. Testing OpenCode plugin tool registration for dashboard tools...");
const pluginInstance = await ParallelExecutorPlugin({
  directory: process.cwd(),
  worktree: process.cwd(),
  serverUrl: new URL("http://localhost:4096"),
  client: {},
  project: {},
  $: {},
});

const tools = pluginInstance.tool;
const expectedTools = ["dashboard", "ui", "fast_dashboard", "background_dashboard", "terminal_ui"];
for (const t of expectedTools) {
  assert.ok(tools[t], `Tool '${t}' must be registered in OpenCode plugin`);
  assert.strictEqual(typeof tools[t].execute, "function", `Tool '${t}.execute' must be a function`);
}
console.log("   ✅ All UI dashboard tools verified in OpenCode plugin!");

// Cleanup plugin
await pluginInstance.dispose();

console.log("\n=================================================");
console.log("🎉 ALL UI & DASHBOARD TESTS PASSED (100%)!");
console.log("=================================================\n");

process.exit(0);
