import { z } from "zod";
export declare const FindReferencesArgsSchema: {
    symbol: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    maxResults: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
};
export type FindReferencesArgs = {
    symbol: string;
    path?: string;
    maxResults?: number;
};
export interface SymbolReferenceItem {
    file: string;
    line: number;
    kind: "definition" | "import" | "call" | "usage";
    snippet: string;
}
export declare class CodeReferenceLocator {
    private baseDir;
    private searcher;
    constructor(baseDir?: string);
    private classifyUsage;
    findReferences(args: FindReferencesArgs, sessionDir?: string): Promise<string>;
}
//# sourceMappingURL=references.d.ts.map