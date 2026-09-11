export interface ShellExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
}
/**
 * PersistentShell maintains a pool of pre-warmed /bin/sh worker processes.
 * Commands execute with zero fork/exec startup overhead (< 1ms).
 */
export declare class PersistentShell {
    private static instance;
    private workers;
    private maxWorkers;
    private queue;
    constructor(initialWorkers?: number, maxWorkers?: number);
    static getInstance(maxWorkers?: number): PersistentShell;
    setMaxWorkers(max: number): void;
    getWorkerCount(): number;
    execute(command: string, cwd?: string, timeoutMs?: number, abortSignal?: AbortSignal): Promise<ShellExecutionResult>;
    private processQueue;
    shutdown(): void;
}
//# sourceMappingURL=persistent-shell.d.ts.map