import { type ChildProcess } from "node:child_process";
import { type WriteStream } from "node:fs";
import { z } from "zod";
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
export declare const BackgroundRunArgsSchema: {
    command: z.ZodString;
    id: z.ZodOptional<z.ZodString>;
    cwd: z.ZodOptional<z.ZodString>;
    waitMs: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
};
export declare const BackgroundStatusArgsSchema: {
    id: z.ZodOptional<z.ZodString>;
};
export declare const BackgroundLogsArgsSchema: {
    id: z.ZodString;
    lines: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    offset: z.ZodOptional<z.ZodNumber>;
    search: z.ZodOptional<z.ZodString>;
    clear: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
};
export declare const BackgroundInputArgsSchema: {
    id: z.ZodString;
    input: z.ZodString;
};
export declare const BackgroundStopArgsSchema: {
    id: z.ZodString;
    signal: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        SIGTERM: "SIGTERM";
        SIGINT: "SIGINT";
        SIGKILL: "SIGKILL";
    }>>>;
    force: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
};
export declare const BackgroundNotificationsArgsSchema: {
    clear: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
};
export declare const BackgroundTerminalMasterArgsSchema: {
    action: z.ZodEnum<{
        input: "input";
        run: "run";
        start: "start";
        status: "status";
        list: "list";
        logs: "logs";
        read: "read";
        send: "send";
        stop: "stop";
        kill: "kill";
        notifications: "notifications";
    }>;
    command: z.ZodOptional<z.ZodString>;
    id: z.ZodOptional<z.ZodString>;
    cwd: z.ZodOptional<z.ZodString>;
    waitMs: z.ZodOptional<z.ZodNumber>;
    lines: z.ZodOptional<z.ZodNumber>;
    search: z.ZodOptional<z.ZodString>;
    input: z.ZodOptional<z.ZodString>;
    signal: z.ZodOptional<z.ZodEnum<{
        SIGTERM: "SIGTERM";
        SIGINT: "SIGINT";
        SIGKILL: "SIGKILL";
    }>>;
    force: z.ZodOptional<z.ZodBoolean>;
    clear: z.ZodOptional<z.ZodBoolean>;
};
export declare class BackgroundTerminalManager {
    private static instance;
    private rootDir;
    private terminals;
    private pendingNotifications;
    private completionListeners;
    private maxStoredNotifications;
    private nextSeq;
    private maxRingBufferLines;
    private logDir;
    private isCleanupRegistered;
    private constructor();
    static getInstance(rootDir?: string): BackgroundTerminalManager;
    private registerProcessCleanup;
    private ensureLogDir;
    /**
     * Registers a callback listener invoked whenever any background terminal finishes.
     */
    onCompletion(listener: (notif: BackgroundCompletionNotification) => void): () => void;
    /**
     * Returns and optionally drains all queued completion notifications.
     */
    getPendingNotifications(clear?: boolean): BackgroundCompletionNotification[];
    /**
     * Peeks at pending completion notifications without draining them.
     */
    peekPendingNotifications(): BackgroundCompletionNotification[];
    /**
     * Clears all pending completion notifications.
     */
    clearNotifications(): void;
    /**
     * Returns human-readable notification text for main agent turns.
     */
    getNotificationsFormatted(clear?: boolean): string;
    /**
     * Emits a completion event, enqueues the notification, and notifies all listeners.
     */
    emitCompletion(record: BackgroundTerminalRecord): void;
    /**
     * Starts a shell process in the background and returns immediately
     * after a brief grace period (default 300ms) with initial status & output.
     */
    start(args: z.infer<z.ZodObject<typeof BackgroundRunArgsSchema>>, sessionDir?: string, sessionId?: string): Promise<string>;
    /**
     * Retrieves status for a specific terminal, or formats a complete table
     * of all running and recent background terminals.
     */
    getStatus(id?: string): string;
    /**
     * Retrieves output logs from the specified terminal.
     */
    getLogs(args: z.infer<z.ZodObject<typeof BackgroundLogsArgsSchema>>): string;
    /**
     * Sends text input to the terminal's stdin.
     */
    sendInput(args: z.infer<z.ZodObject<typeof BackgroundInputArgsSchema>>): string;
    /**
     * Gracefully or forcefully terminates a background terminal and its entire process tree.
     */
    stop(args: z.infer<z.ZodObject<typeof BackgroundStopArgsSchema>>): Promise<string>;
    /**
     * Master dispatcher for single-tool execution (matches manage_task pattern).
     */
    executeMaster(args: z.infer<z.ZodObject<typeof BackgroundTerminalMasterArgsSchema>>, sessionDir?: string): Promise<string>;
    getAllTerminals(): BackgroundTerminalRecord[];
    disposeAll(): Promise<void>;
}
//# sourceMappingURL=background-terminal.d.ts.map