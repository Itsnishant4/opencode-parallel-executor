import { NormalizedOp, ExecutionOptions, ParallelExecuteResult } from "./types.js";
export declare class TaskExecutor {
    private baseDir;
    private options;
    private abortSignal?;
    private backups;
    private static knownDirs;
    private fileCache;
    private bashRunner;
    constructor(baseDir: string, options?: ExecutionOptions, abortSignal?: AbortSignal);
    private resolvePath;
    /**
     * Snapshot file before mutation for rollback safety
     */
    private snapshotFile;
    /**
     * Revert all mutated files if rollback is triggered
     */
    rollback(): Promise<void>;
    private checkAborted;
    /**
     * High-performance stream reader with early termination for line-ranges
     */
    private readLinesStream;
    private executeRead;
    private executeWrite;
    private executeEdit;
    private executeCommand;
    private executeTask;
    /**
     * Continuous Dynamic DAG Execution:
     * Executes tasks as soon as their exact prerequisites finish with zero barrier latency.
     */
    executeContinuousDAG(ops: NormalizedOp[]): Promise<ParallelExecuteResult>;
}
//# sourceMappingURL=executor.d.ts.map