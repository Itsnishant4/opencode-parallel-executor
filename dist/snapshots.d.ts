import { z } from "zod";
export declare const SnapshotArgsSchema: {
    message: z.ZodOptional<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
};
export declare const UndoArgsSchema: {
    snapshotId: z.ZodOptional<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
};
export interface FileSnapshotEntry {
    path: string;
    content: string | null;
    existed: boolean;
}
export interface WorkingTreeSnapshot {
    id: string;
    index: number;
    timestamp: number;
    createdAt: string;
    message?: string;
    files: Map<string, FileSnapshotEntry>;
}
export interface DirtyFileInfo {
    path: string;
    statusCode: string;
    untracked: boolean;
}
export declare class WorkingTreeSnapshotManager {
    private static instance;
    private snapshots;
    private nextId;
    private maxSnapshots;
    private cache;
    private baseDir;
    constructor(baseDir?: string);
    static getInstance(baseDir?: string): WorkingTreeSnapshotManager;
    clear(): void;
    private getDirtyFiles;
    takeSnapshot(args?: {
        message?: string;
        path?: string;
    }, sessionDir?: string): Promise<string>;
    restoreSnapshot(args?: {
        snapshotId?: string;
        path?: string;
    }, sessionDir?: string): Promise<string>;
    listSnapshots(): string;
}
//# sourceMappingURL=snapshots.d.ts.map