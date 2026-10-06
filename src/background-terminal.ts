import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { z } from "zod";
import { OutputCompactor } from "./compact-output.js";

export interface BackgroundCompletionNotification {
  id: string;
  command: string;
  cwd: string;
  pid: number | undefined;
  status: "exited" | "error" | "killed";
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  startTime: number;
  completedAt: number;
  lastOutputSummary: string;
  formattedMessage: string;
  sessionId?: string;
}

export interface BackgroundTerminalRecord {
  id: string;
  command: string;
  cwd: string;
  pid: number | undefined;
  status: "running" | "exited" | "killed" | "error";
  startTime: number;
  endTime?: number;
  durationMs?: number;
  exitCode: number | null;
  signal: string | null;
  logFilePath?: string;
  totalLines: number;
  buffer: string[];
  proc: ChildProcess;
  logStream?: WriteStream;
  sessionId?: string;
  completionNotified?: boolean;
}

export const BackgroundRunArgsSchema = {
  command: z
    .string()
    .describe("Shell command to run in the background (e.g. dev server, long-running test, build, watcher, daemon)"),
  id: z
    .string()
    .optional()
    .describe("Optional custom terminal identifier (e.g. 'dev-server', 'vite', 'test-watch'). Auto-generated if omitted."),
  cwd: z
    .string()
    .optional()
    .describe("Working directory for command execution. Defaults to the workspace directory."),
  waitMs: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .default(300)
    .optional()
    .describe("Milliseconds to wait after launch to capture initial startup logs or early failure (default: 300ms)."),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional environment variables to inject into the background process."),
};

export const BackgroundStatusArgsSchema = {
  id: z
    .string()
    .optional()
    .describe("Terminal ID to inspect. If omitted, lists all running and recent background terminals."),
};

export const BackgroundLogsArgsSchema = {
  id: z
    .string()
    .describe("Terminal ID to fetch output logs for."),
  lines: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .default(60)
    .optional()
    .describe("Number of recent log lines to retrieve (default: 60)."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Line index offset to read from (for pagination)."),
  search: z
    .string()
    .optional()
    .describe("Optional text or regex pattern to filter returned log lines."),
  clear: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, clears the retrieved lines from the in-memory ring buffer."),
};

export const BackgroundInputArgsSchema = {
  id: z
    .string()
    .describe("Terminal ID of the running background process to send input to."),
  input: z
    .string()
    .describe("Input text to write to stdin (e.g. 'y', 'rs', 'exit'). Newline will be automatically appended if missing."),
};

export const BackgroundStopArgsSchema = {
  id: z
    .string()
    .describe("Terminal ID of the background process to terminate."),
  signal: z
    .enum(["SIGTERM", "SIGINT", "SIGKILL"])
    .default("SIGTERM")
    .optional()
    .describe("Signal to send (default: SIGTERM)."),
  force: z
    .boolean()
    .default(false)
    .optional()
    .describe("If true, immediately force-terminates the entire process tree using SIGKILL."),
};

export const BackgroundNotificationsArgsSchema = {
  clear: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to drain/clear retrieved notifications from the pending queue (default: true)."),
};

export const BackgroundTerminalMasterArgsSchema = {
  action: z
    .enum(["run", "start", "status", "list", "logs", "read", "input", "send", "stop", "kill", "notifications"])
    .describe("Action to perform on background terminals: 'run' (launch), 'status'/'list' (inspect), 'logs' (read output), 'input' (send stdin), 'stop'/'kill' (terminate), or 'notifications' (drain completion alerts)."),
  command: z.string().optional().describe("Command to run when action is 'run'/'start'"),
  id: z.string().optional().describe("Terminal identifier"),
  cwd: z.string().optional().describe("Working directory for execution"),
  waitMs: z.number().int().min(0).max(10000).optional().describe("Grace period wait in ms on start"),
  lines: z.number().int().min(1).max(2000).optional().describe("Number of log lines to retrieve"),
  search: z.string().optional().describe("Text or regex filter for logs"),
  input: z.string().optional().describe("Text to send to stdin"),
  signal: z.enum(["SIGTERM", "SIGINT", "SIGKILL"]).optional().describe("Kill signal to send"),
  force: z.boolean().optional().describe("Force kill flag"),
  clear: z.boolean().optional().describe("Clear notifications flag when action is 'notifications'"),
};

export class BackgroundTerminalManager {
  private static instance: BackgroundTerminalManager | null = null;
  private rootDir: string;
  private terminals = new Map<string, BackgroundTerminalRecord>();
  private pendingNotifications: BackgroundCompletionNotification[] = [];
  private completionListeners: Array<(notif: BackgroundCompletionNotification) => void> = [];
  private maxStoredNotifications = 100;
  private nextSeq = 1;
  private maxRingBufferLines = 5000;
  private logDir: string;
  private isCleanupRegistered = false;

  private constructor(rootDir: string = process.cwd()) {
    this.rootDir = path.resolve(rootDir);
    this.logDir = path.join(this.rootDir, ".opencode", "logs");
    this.registerProcessCleanup();
  }

  public static getInstance(rootDir?: string): BackgroundTerminalManager {
    if (!BackgroundTerminalManager.instance) {
      BackgroundTerminalManager.instance = new BackgroundTerminalManager(rootDir);
    } else if (rootDir && BackgroundTerminalManager.instance.rootDir !== path.resolve(rootDir)) {
      // Re-root if needed
      BackgroundTerminalManager.instance.rootDir = path.resolve(rootDir);
      BackgroundTerminalManager.instance.logDir = path.join(path.resolve(rootDir), ".opencode", "logs");
    }
    return BackgroundTerminalManager.instance;
  }

  private registerProcessCleanup(): void {
    if (this.isCleanupRegistered) return;
    this.isCleanupRegistered = true;

    const cleanup = () => {
      for (const [id, term] of this.terminals) {
        if (term.status === "running" && term.pid) {
          try {
            process.kill(-term.pid, "SIGKILL");
          } catch {
            try {
              term.proc.kill("SIGKILL");
            } catch {}
          }
        }
      }
    };

    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  private async ensureLogDir(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch {}
  }

  /**
   * Registers a callback listener invoked whenever any background terminal finishes.
   */
  public onCompletion(listener: (notif: BackgroundCompletionNotification) => void): () => void {
    this.completionListeners.push(listener);
    return () => {
      const idx = this.completionListeners.indexOf(listener);
      if (idx !== -1) this.completionListeners.splice(idx, 1);
    };
  }

  /**
   * Returns and optionally drains all queued completion notifications.
   */
  public getPendingNotifications(clear = true): BackgroundCompletionNotification[] {
    if (!clear) return [...this.pendingNotifications];
    const notifs = [...this.pendingNotifications];
    this.pendingNotifications = [];
    return notifs;
  }

  /**
   * Peeks at pending completion notifications without draining them.
   */
  public peekPendingNotifications(): BackgroundCompletionNotification[] {
    return [...this.pendingNotifications];
  }

  /**
   * Clears all pending completion notifications.
   */
  public clearNotifications(): void {
    this.pendingNotifications = [];
  }

  /**
   * Removes a specific notification from the pending queue (e.g. when claimed by promptAsync).
   */
  public removePendingNotification(target: BackgroundCompletionNotification): boolean {
    const idx = this.pendingNotifications.findIndex(
      (n) => n === target || (n.id === target.id && n.completedAt === target.completedAt)
    );
    if (idx !== -1) {
      this.pendingNotifications.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Re-queues a notification if async session delivery fails.
   */
  public requeueNotification(notif: BackgroundCompletionNotification): void {
    const exists = this.pendingNotifications.some(
      (n) => n === notif || (n.id === notif.id && n.completedAt === notif.completedAt)
    );
    if (!exists) {
      this.pendingNotifications.push(notif);
      if (this.pendingNotifications.length > this.maxStoredNotifications) {
        this.pendingNotifications.shift();
      }
    }
  }

  /**
   * Returns human-readable notification text for main agent turns.
   */
  public getNotificationsFormatted(clear = true): string {
    const notifs = this.getPendingNotifications(clear);
    if (notifs.length === 0) {
      return "ℹ️ No pending background terminal completion notifications.";
    }
    return `🔔 Background Terminal Completion Notifications (${notifs.length} event${notifs.length > 1 ? "s" : ""}):\n\n` +
      notifs.map((n) => n.formattedMessage).join("\n\n");
  }

  /**
   * Emits a completion event, enqueues the notification, and notifies all listeners.
   */
  public emitCompletion(record: BackgroundTerminalRecord): void {
    if (record.completionNotified) return;
    record.completionNotified = true;

    const durationSec = ((record.durationMs ?? (Date.now() - record.startTime)) / 1000).toFixed(1);
    const isSuccess = record.status === "exited" && (record.exitCode === 0 || record.exitCode === null);
    const statusIcon = isSuccess ? "🟢" : (record.status === "killed" ? "🛑" : "🔴");
    const statusDesc = isSuccess
      ? "SUCCESS (Exit code 0)"
      : (record.status === "killed" ? `TERMINATED / KILLED (Signal: ${record.signal || "SIGTERM"})` : `FAILED (Exit code ${record.exitCode ?? "?"})`);

    const lastLines = record.buffer
      .slice(-6)
      .map((l) => OutputCompactor.stripAnsi(l).trimEnd())
      .filter(Boolean);
    const summaryText = lastLines.length > 0 ? lastLines.join("\n") : "[No output captured]";

    const formattedMessage = `🔔 [BACKGROUND TERMINAL COMPLETED] ${statusIcon}
=================================================
• Terminal ID:  ${record.id}
• Command:      ${record.command}
• Process ID:   ${record.pid ?? "N/A"}
• Status:       ${statusDesc}
• Duration:     ${durationSec}s
• Working Dir:  ${record.cwd}
• Completed At: ${new Date().toLocaleTimeString()}
=================================================
📄 Output Summary:
${summaryText}
=================================================`;

    const notif: BackgroundCompletionNotification = {
      id: record.id,
      command: record.command,
      cwd: record.cwd,
      pid: record.pid,
      status: record.status === "running" ? "exited" : record.status,
      exitCode: record.exitCode,
      signal: record.signal,
      durationMs: record.durationMs ?? (Date.now() - record.startTime),
      startTime: record.startTime,
      completedAt: Date.now(),
      lastOutputSummary: summaryText,
      formattedMessage,
      sessionId: record.sessionId,
    };

    this.pendingNotifications.push(notif);
    if (this.pendingNotifications.length > this.maxStoredNotifications) {
      this.pendingNotifications.shift();
    }

    for (const listener of this.completionListeners) {
      try {
        listener(notif);
      } catch (err) {
        console.error("Error in background terminal completion listener:", err);
      }
    }
  }

  /**
   * Starts a shell process in the background and returns immediately
   * after a brief grace period (default 300ms) with initial status & output.
   */
  public async start(
    args: z.infer<z.ZodObject<typeof BackgroundRunArgsSchema>>,
    sessionDir?: string,
    sessionId?: string
  ): Promise<string> {
    const rawCommand = (args.command || "").trim();
    if (!rawCommand) {
      return "❌ Error: 'command' argument is required for background terminal execution.";
    }

    const effectiveDir = args.cwd
      ? (path.isAbsolute(args.cwd) ? args.cwd : path.resolve(sessionDir || this.rootDir, args.cwd))
      : sessionDir ? path.resolve(sessionDir) : this.rootDir;

    // Generate or validate terminal ID
    let termId = (args.id || "").trim();
    if (!termId) {
      termId = `bg-${this.nextSeq++}`;
    }

    // Check if ID is already running
    const existing = this.terminals.get(termId);
    if (existing && existing.status === "running") {
      return `❌ Error: Background terminal with ID '${termId}' is already running (PID: ${existing.pid}, Command: '${existing.command}'). Use a different ID or call 'background_stop(id='${termId}')' first.`;
    }

    await this.ensureLogDir();
    const logFilePath = path.join(this.logDir, `terminal-${termId}.log`);
    let logStream: WriteStream | undefined;
    try {
      logStream = createWriteStream(logFilePath, { flags: "a" });
    } catch {}

    const startTime = Date.now();
    const waitMs = args.waitMs ?? 300;

    // Spawn detached process with independent process group
    const proc = spawn("/bin/sh", ["-c", rawCommand], {
      cwd: effectiveDir,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(args.env || {}),
        TERM: "xterm-256color",
        FORCE_COLOR: "1",
        PAGER: "cat",
      },
    });

    const record: BackgroundTerminalRecord = {
      id: termId,
      command: rawCommand,
      cwd: effectiveDir,
      pid: proc.pid,
      status: "running",
      startTime,
      exitCode: null,
      signal: null,
      logFilePath,
      totalLines: 0,
      buffer: [],
      proc,
      logStream,
      sessionId,
      completionNotified: false,
    };

    const appendLog = (chunk: string) => {
      const lines = chunk.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === lines.length - 1 && line === "") continue;
        record.buffer.push(line);
        record.totalLines++;
        if (record.buffer.length > this.maxRingBufferLines) {
          record.buffer.shift();
        }
      }
      if (record.logStream && !record.logStream.destroyed) {
        try {
          record.logStream.write(chunk);
        } catch {}
      }
    };

    proc.stdout?.setEncoding("utf-8");
    proc.stderr?.setEncoding("utf-8");

    proc.stdout?.on("data", (data: string) => appendLog(data));
    proc.stderr?.on("data", (data: string) => appendLog(data));

    proc.on("error", (err: Error) => {
      record.status = "error";
      record.endTime = Date.now();
      record.durationMs = record.endTime - record.startTime;
      appendLog(`\n[Process error: ${err.message}]`);
      this.emitCompletion(record);
    });

    proc.on("close", (code: number | null, signal: string | null) => {
      if (record.status === "running") {
        record.status = code === 0 ? "exited" : "error";
      }
      record.exitCode = code;
      record.signal = signal;
      record.endTime = Date.now();
      record.durationMs = record.endTime - record.startTime;
      if (record.logStream && !record.logStream.destroyed) {
        try {
          record.logStream.end();
        } catch {}
      }
      this.emitCompletion(record);
    });

    this.terminals.set(termId, record);

    // Initial wait grace period: allow early exit detection or capture startup logs
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const initialOutput = record.buffer.slice(0, 40).join("\n").trim();
    const formattedInitial = initialOutput ? `\n--- Initial Output ---\n${initialOutput}\n----------------------` : "";

    if (record.status !== "running") {
      const exitNote = record.exitCode !== null ? `exit code ${record.exitCode}` : `signal ${record.signal}`;
      return `⚠️ Background terminal '${termId}' completed quickly (${record.durationMs ?? 0}ms, ${exitNote}):\nCommand: ${rawCommand}\nPID: ${record.pid}${formattedInitial}`;
    }

    return `🚀 Background Terminal Started Successfully!
=================================================
• Terminal ID:        ${termId}
• Process ID (PID):   ${record.pid}
• Status:             RUNNING (detached process group)
• Working Directory:  ${effectiveDir}
• Command:            ${rawCommand}
• Log File:           ${logFilePath}
=================================================${formattedInitial}

💡 The process is actively running in the background!
You can continue other work (editing files, reading code, running commands) without waiting.
- To inspect status:  background_status(id='${termId}')
- To view live logs:  background_logs(id='${termId}')
- To send stdin:      background_input(id='${termId}', input='...')
- To terminate:       background_stop(id='${termId}')`;
  }

  /**
   * Retrieves status for a specific terminal, or formats a complete table
   * of all running and recent background terminals.
   */
  public getStatus(id?: string): string {
    if (id) {
      const term = this.terminals.get(id.trim());
      if (!term) {
        return `❌ Terminal ID '${id}' not found. Call 'background_status()' without arguments to see all terminals.`;
      }

      const isAlive = term.status === "running";
      const uptimeSec = Math.round(((term.endTime || Date.now()) - term.startTime) / 1000);
      const recent = term.buffer.slice(-10).join("\n");

      return `📋 Background Terminal Status: ${term.id}
=================================================
• Status:          ${term.status.toUpperCase()} ${isAlive ? "🟢" : "⚪"}
• PID:             ${term.pid ?? "N/A"}
• Command:         ${term.command}
• Working Dir:     ${term.cwd}
• Uptime:          ${uptimeSec}s
• Exit Code:       ${term.exitCode !== null ? term.exitCode : (isAlive ? "N/A (running)" : "N/A")}
• Lines Captured:  ${term.totalLines}
• Log File:        ${term.logFilePath || "N/A"}
=================================================
Recent Output (last 10 lines):
${recent || "[No output captured yet]"}`;
    }

    if (this.terminals.size === 0) {
      return "ℹ️ No background terminals have been launched yet. Use 'background_run(command='...')' to start one.";
    }

    const runningList = Array.from(this.terminals.values()).filter((t) => t.status === "running");
    let runningHeader = "";
    if (runningList.length > 0) {
      const items = runningList.map((t) => {
        const up = Math.round((Date.now() - t.startTime) / 1000);
        return `${t.id} (PID ${t.pid ?? "?"}, ${up}s)`;
      });
      runningHeader = `⚡ [RUNNING IN BACKGROUND (${runningList.length})]: ${items.join(" | ")}\n\n`;
    }

    let notifFooter = "";
    if (this.pendingNotifications.length > 0) {
      notifFooter = `\n\n🔔 [${this.pendingNotifications.length} UNREAD COMPLETION NOTIFICATION(S)]\n` +
        this.pendingNotifications.map((n) => `• '${n.id}' (${n.status}, code: ${n.exitCode ?? 0}) - ${n.command}`).join("\n") +
        "\n(Use 'background_notifications()' to review full output summaries)";
    }

    const rows: string[] = [];
    if (runningHeader) rows.push(runningHeader.trimEnd());
    rows.push("┌──────────────┬────────┬──────────┬──────────┬────────────────────────────────────────────────┐");
    rows.push("│ ID           │ PID    │ STATUS   │ DURATION │ COMMAND                                        │");
    rows.push("├──────────────┼────────┼──────────┼──────────┼────────────────────────────────────────────────┤");

    for (const [tId, term] of this.terminals) {
      const isAlive = term.status === "running";
      const durationSec = Math.round(((term.endTime || Date.now()) - term.startTime) / 1000);
      const statusStr = isAlive ? "RUNNING 🟢" : (term.exitCode === 0 ? "EXIT(0) ⚪" : `EXIT(${term.exitCode ?? "?"}) 🔴`);
      const paddedId = tId.padEnd(12).slice(0, 12);
      const paddedPid = String(term.pid ?? "-").padEnd(6).slice(0, 6);
      const paddedStatus = statusStr.padEnd(8).slice(0, 8);
      const paddedDur = `${durationSec}s`.padEnd(8).slice(0, 8);
      const paddedCmd = term.command.slice(0, 46).padEnd(46);

      rows.push(`│ ${paddedId} │ ${paddedPid} │ ${paddedStatus} │ ${paddedDur} │ ${paddedCmd} │`);
    }

    rows.push("└──────────────┴────────┴──────────┴──────────┴────────────────────────────────────────────────┘");
    if (notifFooter) rows.push(notifFooter);
    return rows.join("\n");
  }

  /**
   * Retrieves output logs from the specified terminal.
   */
  public getLogs(args: z.infer<z.ZodObject<typeof BackgroundLogsArgsSchema>>): string {
    const termId = args.id.trim();
    const term = this.terminals.get(termId);
    if (!term) {
      return `❌ Terminal ID '${termId}' not found. Call 'background_status()' to view active terminals.`;
    }

    let lines = [...term.buffer];

    // Optional regex / text search filter
    if (args.search) {
      const query = args.search.trim();
      try {
        const regex = new RegExp(query, "i");
        lines = lines.filter((l) => regex.test(l));
      } catch {
        lines = lines.filter((l) => l.toLowerCase().includes(query.toLowerCase()));
      }
    }

    // Offset / pagination
    if (args.offset !== undefined && args.offset >= 0) {
      lines = lines.slice(args.offset);
    }

    // Line limit (tail)
    const limit = args.lines ?? 60;
    const finalLines = lines.slice(-limit);

    if (args.clear) {
      term.buffer = [];
    }

    const header = `📜 Logs for '${termId}' (${term.status.toUpperCase()}, ${finalLines.length} of ${term.totalLines} total lines):\n`;
    if (finalLines.length === 0) {
      return `${header}[No matching output found]`;
    }

    return header + finalLines.join("\n");
  }

  /**
   * Sends text input to the terminal's stdin.
   */
  public sendInput(args: z.infer<z.ZodObject<typeof BackgroundInputArgsSchema>>): string {
    const termId = args.id.trim();
    const term = this.terminals.get(termId);
    if (!term) {
      return `❌ Terminal ID '${termId}' not found.`;
    }

    if (term.status !== "running" || !term.proc.stdin || term.proc.stdin.destroyed) {
      return `❌ Cannot send input: Terminal '${termId}' is not running (status: ${term.status}).`;
    }

    let input = args.input;
    if (!input.endsWith("\n")) {
      input += "\n";
    }

    try {
      term.proc.stdin.write(input);
      return `✅ Input successfully sent to terminal '${termId}' (PID: ${term.pid}):\n${input.trim()}`;
    } catch (err: any) {
      return `❌ Failed to send input to terminal '${termId}': ${err.message}`;
    }
  }

  /**
   * Gracefully or forcefully terminates a background terminal and its entire process tree.
   */
  public async stop(args: z.infer<z.ZodObject<typeof BackgroundStopArgsSchema>>): Promise<string> {
    const termId = args.id.trim();
    const term = this.terminals.get(termId);
    if (!term) {
      return `❌ Terminal ID '${termId}' not found.`;
    }

    if (term.status !== "running") {
      return `ℹ️ Terminal '${termId}' is already ${term.status} (exit code: ${term.exitCode ?? "N/A"}).`;
    }

    const signal = args.force ? "SIGKILL" : (args.signal || "SIGTERM");
    const pid = term.pid;

    if (!pid) {
      term.status = "killed";
      this.emitCompletion(term);
      return `✅ Terminal '${termId}' marked as stopped.`;
    }

    try {
      // Kill entire process group on POSIX / macOS
      process.kill(-pid, signal);
    } catch (e1) {
      try {
        term.proc.kill(signal);
      } catch (e2) {}
    }

    // Grace period for process to exit
    let exited = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (term.status !== "running") {
        exited = true;
        break;
      }
    }

    // Force kill if not exited
    if (!exited) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          term.proc.kill("SIGKILL");
        } catch {}
      }
      term.status = "killed";
      term.endTime = Date.now();
      term.durationMs = term.endTime - term.startTime;
    } else {
      term.status = "killed";
    }

    if (term.logStream && !term.logStream.destroyed) {
      try {
        term.logStream.end();
      } catch {}
    }

    const durationSec = Math.round(((term.endTime || Date.now()) - term.startTime) / 1000);
    this.emitCompletion(term);
    return `🛑 Background terminal '${termId}' (PID: ${pid}) has been terminated with ${signal} after ${durationSec}s.`;
  }

  /**
   * Master dispatcher for single-tool execution (matches manage_task pattern).
   */
  public async executeMaster(
    args: z.infer<z.ZodObject<typeof BackgroundTerminalMasterArgsSchema>>,
    sessionDir?: string,
    sessionId?: string
  ): Promise<string> {
    switch (args.action) {
      case "run":
      case "start":
        return this.start(
          {
            command: args.command || "",
            id: args.id,
            cwd: args.cwd,
            waitMs: args.waitMs,
          },
          sessionDir,
          sessionId
        );

      case "status":
      case "list":
        return this.getStatus(args.id);

      case "notifications":
        return this.getNotificationsFormatted(args.clear ?? true);

      case "logs":
      case "read":
        if (!args.id) return "❌ Error: 'id' argument is required for reading logs.";
        return this.getLogs({
          id: args.id,
          lines: args.lines,
          search: args.search,
          clear: false,
        });

      case "input":
      case "send":
        if (!args.id) return "❌ Error: 'id' argument is required for sending input.";
        if (args.input === undefined) return "❌ Error: 'input' argument is required.";
        return this.sendInput({
          id: args.id,
          input: args.input,
        });

      case "stop":
      case "kill":
        if (!args.id) return "❌ Error: 'id' argument is required for stopping terminal.";
        return this.stop({
          id: args.id,
          signal: args.signal,
          force: args.force,
        });

      default:
        return `❌ Unknown action '${(args as any).action}'. Supported actions: 'run', 'status', 'logs', 'input', 'stop', 'list'.`;
    }
  }

  public getAllTerminals(): BackgroundTerminalRecord[] {
    return Array.from(this.terminals.values());
  }

  public async disposeAll(): Promise<void> {
    for (const [id, term] of this.terminals) {
      if (term.status === "running") {
        await this.stop({ id, force: true });
      }
    }
    this.terminals.clear();
  }
}
