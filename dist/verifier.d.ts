import { z } from "zod";
export declare const VerifyArgsSchema: {
    type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        typecheck: "typecheck";
        lint: "lint";
        all: "all";
    }>>>;
    path: z.ZodOptional<z.ZodString>;
    fix: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
};
export type VerifyArgs = {
    type?: "typecheck" | "lint" | "all";
    path?: string;
    fix?: boolean;
};
export interface DiagnosticItem {
    file: string;
    line: number;
    col?: number;
    severity: "error" | "warning";
    code?: string;
    message: string;
}
export interface VerificationCheckResult {
    name: string;
    command: string;
    exitCode: number;
    durationMs: number;
    diagnostics: DiagnosticItem[];
    rawOutput: string;
}
export declare class CodebaseVerifier {
    private baseDir;
    private bashRunner;
    constructor(baseDir?: string);
    private fileExists;
    private detectChecks;
    parseDiagnostics(rawOutput: string, checkName: string): DiagnosticItem[];
    verify(args?: VerifyArgs, sessionDir?: string, abortSignal?: AbortSignal): Promise<string>;
}
//# sourceMappingURL=verifier.d.ts.map