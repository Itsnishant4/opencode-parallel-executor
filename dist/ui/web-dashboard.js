import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { FastFileCache } from "../fast-cache.js";
import { BackgroundTerminalManager } from "../background-terminal.js";
import { getDashboardHtml } from "./dashboard-html.js";
export class WebDashboardServer {
    static instance = null;
    server = null;
    activePort = null;
    rootDir;
    isStarting = false;
    constructor(rootDir = process.cwd()) {
        this.rootDir = path.resolve(rootDir);
    }
    static getInstance(rootDir) {
        if (!WebDashboardServer.instance) {
            WebDashboardServer.instance = new WebDashboardServer(rootDir);
        }
        else if (rootDir && WebDashboardServer.instance.rootDir !== path.resolve(rootDir)) {
            WebDashboardServer.instance.rootDir = path.resolve(rootDir);
        }
        return WebDashboardServer.instance;
    }
    /**
     * Starts the local dashboard HTTP server if not already running.
     */
    async start(preferredPort = 20888) {
        if (this.server && this.activePort) {
            return { url: `http://localhost:${this.activePort}`, port: this.activePort };
        }
        if (this.isStarting) {
            while (this.isStarting) {
                await new Promise((r) => setTimeout(r, 50));
            }
            if (this.server && this.activePort) {
                return { url: `http://localhost:${this.activePort}`, port: this.activePort };
            }
        }
        this.isStarting = true;
        try {
            const port = await this.bindServer(preferredPort);
            this.activePort = port;
            const url = `http://localhost:${port}`;
            // Save a local static copy of the dashboard in .opencode/dashboard.html
            await this.saveStaticFile(port);
            return { url, port };
        }
        finally {
            this.isStarting = false;
        }
    }
    async bindServer(startPort) {
        return new Promise((resolve, reject) => {
            let currentPort = startPort;
            const tryBind = () => {
                const s = http.createServer((req, res) => this.handleRequest(req, res));
                s.unref(); // Ensure server doesn't hold open Node process on exit
                s.on("listening", () => {
                    this.server = s;
                    resolve(currentPort);
                });
                s.on("error", (err) => {
                    if (err.code === "EADDRINUSE" && currentPort < startPort + 50) {
                        currentPort++;
                        tryBind();
                    }
                    else {
                        reject(err);
                    }
                });
                s.listen(currentPort, "127.0.0.1");
            };
            tryBind();
        });
    }
    async handleRequest(req, res) {
        const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");
        const pathname = parsedUrl.pathname;
        // CORS headers for local web & desktop integration
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        // 1. Root: Serve interactive HTML Dashboard
        if (pathname === "/" || pathname === "/dashboard") {
            const state = this.getCurrentState(this.activePort || 20888);
            const html = getDashboardHtml(state);
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
            return;
        }
        // 2. API: Engine & Terminals Status
        if (pathname === "/api/status" && req.method === "GET") {
            const state = this.getCurrentState(this.activePort || 20888);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(state));
            return;
        }
        // 3. API: Terminal Logs
        if (pathname === "/api/logs" && req.method === "GET") {
            const id = parsedUrl.searchParams.get("id");
            const lines = parseInt(parsedUrl.searchParams.get("lines") || "80", 10);
            const search = parsedUrl.searchParams.get("search") || undefined;
            if (!id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Missing 'id' query parameter" }));
                return;
            }
            const bgMgr = BackgroundTerminalManager.getInstance(this.rootDir);
            const terms = bgMgr.getAllTerminals();
            const term = terms.find((t) => t.id === id);
            if (!term) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Terminal not found", lines: [] }));
                return;
            }
            let logLines = [...term.buffer];
            if (search) {
                const q = search.toLowerCase();
                logLines = logLines.filter((l) => l.toLowerCase().includes(q));
            }
            const finalLines = logLines.slice(-lines);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id, lines: finalLines, total: term.totalLines }));
            return;
        }
        // Read POST body helper
        const readBody = async () => {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
            }
            const text = Buffer.concat(chunks).toString("utf-8");
            try {
                return JSON.parse(text);
            }
            catch {
                return {};
            }
        };
        // 4. API: Run Background Terminal
        if (pathname === "/api/run" && req.method === "POST") {
            const body = await readBody();
            const bgMgr = BackgroundTerminalManager.getInstance(this.rootDir);
            try {
                const out = await bgMgr.start({
                    command: body.command || "",
                    id: body.id,
                    cwd: body.cwd,
                    waitMs: body.waitMs ?? 300,
                });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, output: out }));
            }
            catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }
        // 5. API: Stop Terminal
        if (pathname === "/api/stop" && req.method === "POST") {
            const body = await readBody();
            const bgMgr = BackgroundTerminalManager.getInstance(this.rootDir);
            try {
                const out = await bgMgr.stop({ id: body.id || "", force: body.force ?? true });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, output: out }));
            }
            catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }
        // 6. API: Send Stdin Input
        if (pathname === "/api/input" && req.method === "POST") {
            const body = await readBody();
            const bgMgr = BackgroundTerminalManager.getInstance(this.rootDir);
            try {
                const out = bgMgr.sendInput({ id: body.id || "", input: body.input || "" });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, output: out }));
            }
            catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }
        // 7. API: Cache Clear
        if (pathname === "/api/cache/clear" && req.method === "POST") {
            FastFileCache.getInstance().clear();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
    }
    getCurrentState(port) {
        const bgMgr = BackgroundTerminalManager.getInstance(this.rootDir);
        const cache = FastFileCache.getInstance();
        const cacheStats = cache.getStats();
        const terminals = bgMgr.getAllTerminals().map((t) => ({
            id: t.id,
            command: t.command,
            cwd: t.cwd,
            pid: t.pid,
            status: t.status,
            startTime: t.startTime,
            endTime: t.endTime,
            durationMs: t.durationMs,
            exitCode: t.exitCode,
            totalLines: t.totalLines,
            buffer: t.buffer.slice(-100),
        }));
        return {
            terminals,
            cacheStats,
            rootDir: this.rootDir,
            port,
        };
    }
    async saveStaticFile(port) {
        const state = this.getCurrentState(port);
        const html = getDashboardHtml(state);
        const outDir = path.join(this.rootDir, ".opencode");
        try {
            await fs.mkdir(outDir, { recursive: true });
            const targetPath = path.join(outDir, "dashboard.html");
            await fs.writeFile(targetPath, html, "utf-8");
            return targetPath;
        }
        catch {
            return "";
        }
    }
    openInBrowser(url) {
        const platform = process.platform;
        try {
            if (platform === "darwin") {
                spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
            }
            else if (platform === "win32") {
                spawn("cmd.exe", ["/c", "start", url], { detached: true, stdio: "ignore" }).unref();
            }
            else {
                spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
            }
        }
        catch { }
    }
    async stop() {
        if (this.server) {
            await new Promise((resolve) => {
                this.server?.close(() => resolve());
            });
            this.server = null;
            this.activePort = null;
        }
    }
}
//# sourceMappingURL=web-dashboard.js.map