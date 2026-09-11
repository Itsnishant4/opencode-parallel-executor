import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { FastFileCache } from "./fast-cache.js";
import { PersistentShell } from "./persistent-shell.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  inProcess: boolean;
}

export class FastBashRunner {
  private baseDir: string;
  private cache = FastFileCache.getInstance();
  private persistentShell = PersistentShell.getInstance();

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
  }

  private resolvePath(target: string, cwd?: string): string {
    const root = cwd ? path.resolve(this.baseDir, cwd) : this.baseDir;
    return path.isAbsolute(target) ? target : path.resolve(root, target);
  }

  /**
   * Evaluates simple inspection commands in-process within sub-milliseconds.
   * Returns null if the command requires full shell execution.
   */
  private async tryInProcess(
    rawCommand: string,
    cwd?: string
  ): Promise<CommandResult | null> {
    const trimmed = rawCommand.trim();
    const effectiveCwd = cwd ? path.resolve(this.baseDir, cwd) : this.baseDir;

    // Commands with pipes, redirects, or compound chains must use full shell
    if (/[|&;><$*?`~()\r\n]/.test(trimmed)) {
      return null;
    }

    const t0 = Date.now();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const cleanArg = (arg: string) => arg.replace(/^["']|["']$/g, "");

    // 1. pwd
    if (cmd === "pwd") {
      return {
        stdout: effectiveCwd,
        stderr: "",
        exitCode: 0,
        durationMs: Date.now() - t0,
        inProcess: true,
      };
    }

    // 2. echo
    if (cmd === "echo") {
      const text = args.map(cleanArg).join(" ");
      return {
        stdout: text,
        stderr: "",
        exitCode: 0,
        durationMs: Date.now() - t0,
        inProcess: true,
      };
    }

    // 3. cat <file>
    if (cmd === "cat" && args.length === 1 && !args[0].startsWith("-")) {
      const filePath = this.resolvePath(cleanArg(args[0]), cwd);
      const content = await this.cache.get(filePath);
      if (content !== null) {
        return {
          stdout: content,
          stderr: "",
          exitCode: 0,
          durationMs: Date.now() - t0,
          inProcess: true,
        };
      }
    }

    // 4. head -n <count> <file> or head <file>
    if (cmd === "head") {
      let count = 10;
      let targetFile: string | null = null;

      if (args.length === 1 && !args[0].startsWith("-")) {
        targetFile = cleanArg(args[0]);
      } else if (args.length === 3 && (args[0] === "-n" || args[0] === "-")) {
        count = parseInt(args[1], 10) || 10;
        targetFile = cleanArg(args[2]);
      } else if (args.length === 2 && args[0].startsWith("-n")) {
        count = parseInt(args[0].replace("-n", ""), 10) || 10;
        targetFile = cleanArg(args[1]);
      }

      if (targetFile) {
        const filePath = this.resolvePath(targetFile, cwd);
        const result = await this.cache.getLines(filePath, 1, count, false);
        if (result !== null) {
          const linesOnly = result.content.split("\n").slice(1).join("\n");
          return {
            stdout: linesOnly,
            stderr: "",
            exitCode: 0,
            durationMs: Date.now() - t0,
            inProcess: true,
          };
        }
      }
    }

    // 5. ls [dir]
    if (cmd === "ls") {
      let targetDir = effectiveCwd;
      const nonFlags = args.filter((a) => !a.startsWith("-"));
      if (nonFlags.length === 1) {
        targetDir = this.resolvePath(cleanArg(nonFlags[0]), cwd);
      } else if (nonFlags.length > 1) {
        return null;
      }

      try {
        const entries = await fs.readdir(targetDir);
        return {
          stdout: entries.join("\n"),
          stderr: "",
          exitCode: 0,
          durationMs: Date.now() - t0,
          inProcess: true,
        };
      } catch (err: any) {
        return {
          stdout: "",
          stderr: `ls: cannot access '${targetDir}': ${err.message}`,
          exitCode: 1,
          durationMs: Date.now() - t0,
          inProcess: true,
        };
      }
    }

    // 6. mkdir -p <dir>
    if (cmd === "mkdir" && (args[0] === "-p" || args.length === 1)) {
      const targetDir = args[0] === "-p" ? args[1] : args[0];
      if (targetDir) {
        const resolvedDir = this.resolvePath(cleanArg(targetDir), cwd);
        try {
          await fs.mkdir(resolvedDir, { recursive: true });
          return {
            stdout: "",
            stderr: "",
            exitCode: 0,
            durationMs: Date.now() - t0,
            inProcess: true,
          };
        } catch (err: any) {
          return {
            stdout: "",
            stderr: `mkdir: ${err.message}`,
            exitCode: 1,
            durationMs: Date.now() - t0,
            inProcess: true,
          };
        }
      }
    }

    // 7. touch <file>
    if (cmd === "touch" && args.length === 1 && !args[0].startsWith("-")) {
      const targetFile = this.resolvePath(cleanArg(args[0]), cwd);
      try {
        const handle = await fs.open(targetFile, "a");
        await handle.close();
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: Date.now() - t0,
          inProcess: true,
        };
      } catch (err: any) {
        return {
          stdout: "",
          stderr: `touch: ${err.message}`,
          exitCode: 1,
          durationMs: Date.now() - t0,
          inProcess: true,
        };
      }
    }

    // Not an in-process candidate
    return null;
  }

  /**
   * Executes a command with fast-path in-process detection (< 0.2ms),
   * persistent warm shell worker (< 1ms), and fallback to direct /bin/sh.
   */
  public async execute(
    command: string,
    cwd?: string,
    timeoutMs: number = 60000,
    abortSignal?: AbortSignal
  ): Promise<CommandResult> {
    // 1. Try in-process micro-execution (< 0.2ms)
    const inProc = await this.tryInProcess(command, cwd);
    if (inProc !== null) {
      return inProc;
    }

    const effectiveCwd = cwd ? path.resolve(this.baseDir, cwd) : this.baseDir;

    // 2. Try zero-spawn PersistentShell worker (< 1ms)
    try {
      const res = await this.persistentShell.execute(command, effectiveCwd, timeoutMs, abortSignal);
      return {
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
        durationMs: res.durationMs,
        inProcess: false,
      };
    } catch (err: any) {
      if (abortSignal?.aborted) {
        return {
          stdout: "",
          stderr: "Command aborted by client",
          exitCode: -1,
          durationMs: 0,
          inProcess: false,
        };
      }
      // Fallback to one-off direct process if persistent worker is exhausted or errored
      return this.executeDirectSpawn(command, effectiveCwd, timeoutMs, abortSignal);
    }
  }

  private executeDirectSpawn(
    command: string,
    effectiveCwd: string,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<CommandResult> {
    const t0 = Date.now();

    if (abortSignal?.aborted) {
      return Promise.resolve({
        stdout: "",
        stderr: "Command aborted by client",
        exitCode: -1,
        durationMs: 0,
        inProcess: false,
      });
    }

    return new Promise((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;

      const proc = spawn("/bin/sh", ["-c", command], {
        cwd: effectiveCwd,
        detached: true,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
        },
      });

      const killProc = () => {
        if (proc.pid) {
          try {
            process.kill(-proc.pid, "SIGKILL");
          } catch {
            try {
              proc.kill("SIGKILL");
            } catch {}
          }
        }
        try {
          proc.stdout?.destroy();
          proc.stderr?.destroy();
          proc.stdin?.destroy();
        } catch {}
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killProc();
      }, timeoutMs);

      const abortHandler = () => {
        killProc();
      };

      if (abortSignal) {
        abortSignal.addEventListener("abort", abortHandler, { once: true });
      }

      proc.stdout.on("data", (chunk) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      proc.stderr.on("data", (chunk) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }

        const durationMs = Date.now() - t0;
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");

        if (abortSignal?.aborted) {
          resolve({
            stdout,
            stderr: "Command aborted by client",
            exitCode: -1,
            durationMs,
            inProcess: false,
          });
        } else if (timedOut) {
          resolve({
            stdout,
            stderr: `Command timed out after ${timeoutMs}ms\n${stderr}`,
            exitCode: -1,
            durationMs,
            inProcess: false,
          });
        } else {
          resolve({
            stdout,
            stderr,
            exitCode: code ?? 0,
            durationMs,
            inProcess: false,
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        resolve({
          stdout: "",
          stderr: err.message || String(err),
          exitCode: 1,
          durationMs: Date.now() - t0,
          inProcess: false,
        });
      });
    });
  }
}
