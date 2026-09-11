import { z } from "zod";
export declare const OutlineArgsSchema: {
    path: z.ZodOptional<z.ZodString>;
    filePath: z.ZodOptional<z.ZodString>;
    maxDepth: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
};
export interface CodeSymbol {
    line: number;
    kind: "class" | "interface" | "type" | "function" | "method" | "enum" | "const" | "struct" | "trait" | "impl";
    name: string;
    signature: string;
    exported: boolean;
}
export declare class CodeOutliner {
    private baseDir;
    private cache;
    constructor(baseDir?: string);
    getOutline(args: {
        path?: string;
        filePath?: string;
        maxDepth?: number;
    }, sessionDir?: string): Promise<string>;
    private parseSymbols;
}
//# sourceMappingURL=outline.d.ts.map