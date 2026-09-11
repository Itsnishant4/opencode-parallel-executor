import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export interface ShellExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface ActiveShellTask {
  id: string;
  command: string;
  cwd: string;
  stdoutBuf: string;
  stderrBuf: string;
  outDone: boolean;
  errDone: boolean;
  exitCode: number;
  t0: number;
  timer: NodeJS.Timeout;
  resolve: (res: ShellExecutionResult) => void;
  reject: (err: Error) => void;
}

class PersistentShellWorker {
  private proc!: ChildProcess;
  private busy: boolean = false;
  private activeTask: ActiveShellTask | null = null;
  private isKilled: boolean = false;

  constructor() {
    this.spawnWorker();
  }

  private spawnWorker(): void {
    if (this.isKilled) return;

    this.proc = spawn("/bin/sh", [], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
    });

    this.busy = false;
    this.activeTask = null;

    this.proc.stdout?.setEncoding("utf-8");
    this.proc.stderr?.setEncoding("utf-8");

    this.proc.on("close", (code) => {
      if (this.activeTask) {
        clearTimeout(this.activeTask.timer);
        const task = this.activeTask;
        this.activeTask = null;
        this.busy = false;
        task.resolve({
          stdout: task.stdoutBuf.trim(),
          stderr: (task.stderrBuf + (code !== 0 ? `\nShell terminated with code ${code}` : "")).trim(),
          exitCode: code ?? 1,
          durationMs: Math.round(performance.now() - task.t0),
        });
      }

      if (!this.isKilled) {
        this.spawnWorker();
      }
    });

    this.proc.on("error", (err) => {
      if (this.activeTask) {
        clearTimeout(this.activeTask.timer);
        const task = this.activeTask;
        this.activeTask = null;
        this.busy = false;
        task.reject(err);
      }
    });
  }

  private terminateWorkerProcess(): void {
    if (this.proc.pid) {
      try {
        process.kill(-this.proc.pid, "SIGKILL");
      } catch {
        try {
          this.proc.kill("SIGKILL");
        } catch {}
      }
    }
    try {
      this.proc.stdout?.destroy();
      this.proc.stderr?.destroy();
      this.proc.stdin?.destroy();
    } catch {}
  }

  public isBusy(): boolean {
    return this.busy;
  }

  public execute(
    command: string,
    cwd: string,
    timeoutMs: number = 60000,
    abortSignal?: AbortSignal
  ): Promise<ShellExecutionResult> {
    return new Promise((resolve, reject) => {
      if (this.busy || !this.proc.stdin || !this.proc.stdout || !this.proc.stderr) {
        return reject(new Error("Worker is busy or not ready"));
      }

      if (abortSignal?.aborted) {
        return reject(new Error("Command aborted by client"));
      }

      this.busy = true;
      const id = Math.random().toString(36).slice(2, 10);
      const t0 = performance.now();

      const outSentinel = `__SENTINEL_OUT_${id}_`;
      const errSentinel = `__SENTINEL_ERR_${id}__`;

      const timer = setTimeout(() => {
        if (this.activeTask === task) {
          task.stderrBuf += `\nCommand timed out after ${timeoutMs}ms`;
          task.exitCode = -1;
          this.terminateWorkerProcess();
        }
      }, timeoutMs);

      const task: ActiveShellTask = {
        id,
        command,
        cwd,
        stdoutBuf: "",
        stderrBuf: "",
        outDone: false,
        errDone: false,
        exitCode: 0,
        t0,
        timer,
        resolve,
        reject,
      };
      this.activeTask = task;

      const abortHandler = () => {
        if (this.activeTask === task) {
          clearTimeout(task.timer);
          task.stderrBuf += "\nCommand cancelled via abort signal";
          task.exitCode = -1;
          this.terminateWorkerProcess();
        }
      };

      if (abortSignal) {
        abortSignal.addEventListener("abort", abortHandler, { once: true });
      }

      const checkFinish = () => {
        if (task.outDone && task.errDone) {
          clearTimeout(task.timer);
          if (abortSignal) {
            abortSignal.removeEventListener("abort", abortHandler);
          }
          cleanup();
          this.busy = false;
          this.activeTask = null;
          resolve({
            stdout: task.stdoutBuf.trim(),
            stderr: task.stderrBuf.trim(),
            exitCode: task.exitCode,
            durationMs: Math.round(performance.now() - t0),
          });
        }
      };

      const onStdout = (chunk: string) => {
        if (task.outDone) return;
        task.stdoutBuf += chunk;
        if (task.stdoutBuf.length > 15 * 1024 * 1024) {
          task.stderrBuf += "\nError: stdout buffer exceeded 15MB limit.";
          this.terminateWorkerProcess();
          return;
        }
        const idx = task.stdoutBuf.indexOf(outSentinel);
        if (idx !== -1) {
          const endIdx = task.stdoutBuf.indexOf("__", idx + outSentinel.length);
          if (endIdx !== -1) {
            const codeStr = task.stdoutBuf.substring(idx + outSentinel.length, endIdx);
            task.exitCode = parseInt(codeStr, 10) || 0;
            task.stdoutBuf = task.stdoutBuf.substring(0, idx);
            task.outDone = true;
            this.proc.stdout?.off("data", onStdout);
            checkFinish();
          }
        }
      };

      const onStderr = (chunk: string) => {
        if (task.errDone) return;
        task.stderrBuf += chunk;
        if (task.stderrBuf.length > 15 * 1024 * 1024) {
          task.stderrBuf += "\nError: stderr buffer exceeded 15MB limit.";
          this.terminateWorkerProcess();
          return;
        }
        const idx = task.stderrBuf.indexOf(errSentinel);
        if (idx !== -1) {
          task.stderrBuf = task.stderrBuf.substring(0, idx);
          task.errDone = true;
          this.proc.stderr?.off("data", onStderr);
          checkFinish();
        }
      };

      const cleanup = () => {
        this.proc.stdout?.off("data", onStdout);
        this.proc.stderr?.off("data", onStderr);
      };

      this.proc.stdout.on("data", onStdout);
      this.proc.stderr.on("data", onStderr);

      // Escape quotes and newlines in cwd
      const escapedCwd = cwd.replace(/[\r\n]/g, "").replace(/(["\\$`])/g, "\\$1");

      // Write command wrapped in isolated subshell with stdin redirected from /dev/null
      const script = `(\ncd "${escapedCwd}"\n${command}\n) < /dev/null\n__CODE=$?\nprintf "\\n__SENTINEL_OUT_${id}_%d__\\n" "$__CODE"\nprintf "\\n__SENTINEL_ERR_${id}__\\n" >&2\n`;
      this.proc.stdin.write(script);
    });
  }

  public kill(): void {
    this.isKilled = true;
    if (this.activeTask) {
      clearTimeout(this.activeTask.timer);
      this.activeTask.reject(new Error("PersistentShell worker was terminated"));
      this.activeTask = null;
      this.busy = false;
    }
    this.proc.removeAllListeners("exit");
    this.proc.removeAllListeners("close");
    this.terminateWorkerProcess();
  }
}

/**
 * PersistentShell maintains a pool of pre-warmed /bin/sh worker processes.
 * Commands execute with zero fork/exec startup overhead (< 1ms).
 */
export class PersistentShell {
  private static instance: PersistentShell;
  private workers: PersistentShellWorker[] = [];
  private maxWorkers: number = 12;
  private queue: Array<{
    command: string;
    cwd: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    resolve: (res: ShellExecutionResult) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(initialWorkers: number = 2, maxWorkers: number = 12) {
    this.maxWorkers = maxWorkers;
    for (let i = 0; i < initialWorkers; i++) {
      this.workers.push(new PersistentShellWorker());
    }
  }

  public static getInstance(maxWorkers: number = 12): PersistentShell {
    if (!PersistentShell.instance) {
      PersistentShell.instance = new PersistentShell(2, maxWorkers);
    } else if (maxWorkers > PersistentShell.instance.maxWorkers) {
      PersistentShell.instance.maxWorkers = maxWorkers;
    }
    return PersistentShell.instance;
  }

  public setMaxWorkers(max: number): void {
    this.maxWorkers = Math.max(this.maxWorkers, max);
  }

  public getWorkerCount(): number {
    return this.workers.length;
  }

  public async execute(
    command: string,
    cwd: string = process.cwd(),
    timeoutMs: number = 60000,
    abortSignal?: AbortSignal
  ): Promise<ShellExecutionResult> {
    const idleWorker = this.workers.find((w) => !w.isBusy());
    if (idleWorker) {
      return idleWorker.execute(command, cwd, timeoutMs, abortSignal).finally(() => {
        this.processQueue();
      });
    }

    if (this.workers.length < this.maxWorkers) {
      const newWorker = new PersistentShellWorker();
      this.workers.push(newWorker);
      return newWorker.execute(command, cwd, timeoutMs, abortSignal).finally(() => {
        this.processQueue();
      });
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        command,
        cwd,
        timeoutMs,
        abortSignal,
        resolve,
        reject,
      });
    });
  }

  private processQueue(): void {
    while (this.queue.length > 0) {
      const idleWorker = this.workers.find((w) => !w.isBusy());
      if (!idleWorker) break;

      const task = this.queue.shift();
      if (!task) break;

      if (task.abortSignal?.aborted) {
        task.reject(new Error("Command aborted by client"));
        continue;
      }

      idleWorker
        .execute(task.command, task.cwd, task.timeoutMs, task.abortSignal)
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          this.processQueue();
        });
    }
  }

  public shutdown(): void {
    for (const worker of this.workers) {
      worker.kill();
    }
    this.workers = [];
    for (const task of this.queue) {
      task.reject(new Error("PersistentShell was shut down"));
    }
    this.queue = [];
  }
}
