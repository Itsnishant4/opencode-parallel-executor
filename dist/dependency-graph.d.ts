import { NormalizedOp, ReadOperationInput, WriteOperationInput, EditOperationInput, CommandOperationInput } from "./types.js";
export declare function isSetupCommand(cmd: string): boolean;
export declare function isVerificationCommand(cmd: string): boolean;
export declare class DependencyGraph {
    static normalizeOperations(reads?: ReadOperationInput[], writes?: WriteOperationInput[], edits?: EditOperationInput[], commands?: CommandOperationInput[]): NormalizedOp[];
    /**
     * Continuous Dependency Resolver:
     * Infers exact fine-grained dependencies between operations so that independent
     * tasks can execute concurrently at t=0 while dependent tasks wait only on their
     * exact prerequisites. Preserves and merges any user-specified explicit dependencies.
     */
    static resolveFineGrainedDependencies(ops: NormalizedOp[], baseDir?: string): NormalizedOp[];
    /**
     * Validates that the DAG contains no cycles.
     */
    static validateAcyclic(ops: NormalizedOp[]): void;
}
//# sourceMappingURL=dependency-graph.d.ts.map