export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    inProcess: boolean;
}
export declare class FastBashRunner {
    private baseDir;
    private cache;
    private persistentShell;
    constructor(baseDir?: string);
    private resolvePath;
    /**
     * Evaluates simple inspection commands in-process within sub-milliseconds.
     * Returns null if the command requires full shell execution.
     */
    private tryInProcess;
    /**
     * Executes a command with fast-path in-process detection (< 0.2ms),
     * persistent warm shell worker (< 1ms), and fallback to direct /bin/sh.
     */
    execute(command: string, cwd?: string, timeoutMs?: number, abortSignal?: AbortSignal): Promise<CommandResult>;
    private executeDirectSpawn;
}
//# sourceMappingURL=fast-bash.d.ts.map