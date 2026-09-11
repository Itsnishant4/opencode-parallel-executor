import path from "node:path";
import {
  NormalizedOp,
  NormalizedReadOp,
  NormalizedWriteOp,
  NormalizedEditOp,
  NormalizedCommandOp,
  ReadOperationInput,
  WriteOperationInput,
  EditOperationInput,
  CommandOperationInput,
} from "./types.js";

// Check if a command is a setup/dependency-installation command
export function isSetupCommand(cmd: string): boolean {
  const normalized = cmd.trim().toLowerCase();
  const setupPatterns = [
    /^(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b/,
    /^(pip|pip3|poetry|uv)\s+(install|add|sync)\b/,
    /^(cargo)\s+(build|fetch)\b/,
    /^(go)\s+(mod\s+download|get)\b/,
    /^(bundle)\s+(install)\b/,
    /^(composer)\s+(install|update)\b/,
  ];
  return setupPatterns.some((p) => p.test(normalized));
}

// Check if a command is an inspection/verification command (lint, test, typecheck, status)
export function isVerificationCommand(cmd: string): boolean {
  const normalized = cmd.trim().toLowerCase();
  // Exclude non-verification commands that may contain words like 'test' or 'check'
  if (/^git\s+(checkout|switch|branch|status|diff|add|commit|log)\b/.test(normalized)) return false;
  if (/^(mkdir|touch|rm|cp|mv|cat|echo|cd|pwd)\b/.test(normalized)) return false;

  const verifyPatterns = [
    /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|vitest|jest|mocha|lint|typecheck|check)\b/,
    /^(npm|pnpm|yarn|bun)\s+test\b/,
    /^(vitest|jest|mocha|pytest|cargo\s+test|go\s+test)\b/,
    /^(eslint|prettier|biome|flake8|pylint|cargo\s+clippy)\b/,
    /^(tsc|pyright|mypy)\b/,
  ];
  return verifyPatterns.some((p) => p.test(normalized));
}

// Check if a file is a dependency manifest file
function isManifestFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  const manifestNames = [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
    "requirements.txt",
    "pyproject.toml",
    "pipfile",
    "poetry.lock",
    "cargo.toml",
    "cargo.lock",
    "go.mod",
    "go.sum",
    "gemfile",
    "gemfile.lock",
  ];
  return manifestNames.includes(base);
}

export class DependencyGraph {
  public static normalizeOperations(
    reads: ReadOperationInput[] = [],
    writes: WriteOperationInput[] = [],
    edits: EditOperationInput[] = [],
    commands: CommandOperationInput[] = []
  ): NormalizedOp[] {
    const ops: NormalizedOp[] = [];

    // 1. Reads
    reads.forEach((readInput, idx) => {
      if (typeof readInput === "string") {
        ops.push({
          id: `read-${idx + 1}:${path.basename(readInput)}`,
          type: "read",
          path: readInput,
          dependsOn: [],
        });
      } else {
        const lineSuffix = readInput.lines
          ? `:L${readInput.lines}`
          : readInput.startLine !== undefined
          ? `:L${readInput.startLine}-${readInput.endLine ?? ""}`
          : "";
        ops.push({
          id: readInput.id || `read-${idx + 1}:${path.basename(readInput.path)}${lineSuffix}`,
          type: "read",
          path: readInput.path,
          startLine: readInput.startLine,
          endLine: readInput.endLine,
          lines: readInput.lines,
          offset: readInput.offset,
          length: readInput.length,
          withLineNumbers: readInput.withLineNumbers,
          dependsOn: readInput.dependsOn ? [...readInput.dependsOn] : [],
        });
      }
    });

    // 2. Writes
    writes.forEach((writeInput, idx) => {
      ops.push({
        id: writeInput.id || `write-${idx + 1}:${path.basename(writeInput.path)}`,
        type: "write",
        path: writeInput.path,
        content: writeInput.content,
        encoding: writeInput.encoding || "utf-8",
        dependsOn: writeInput.dependsOn ? [...writeInput.dependsOn] : [],
      });
    });

    // 3. Edits
    edits.forEach((editInput, idx) => {
      ops.push({
        id: editInput.id || `edit-${idx + 1}:${path.basename(editInput.path)}`,
        type: "edit",
        path: editInput.path,
        oldText: editInput.oldText,
        newText: editInput.newText,
        replaceAll: editInput.replaceAll || false,
        dependsOn: editInput.dependsOn ? [...editInput.dependsOn] : [],
      });
    });

    // 4. Commands
    commands.forEach((cmdInput, idx) => {
      if (typeof cmdInput === "string") {
        ops.push({
          id: `cmd-${idx + 1}`,
          type: "command",
          command: cmdInput,
          continueOnError: true,
          dependsOn: [],
        });
      } else {
        ops.push({
          id: cmdInput.id || `cmd-${idx + 1}`,
          type: "command",
          command: cmdInput.command,
          cwd: cmdInput.cwd,
          timeoutMs: cmdInput.timeoutMs,
          continueOnError: cmdInput.continueOnError ?? true,
          dependsOn: cmdInput.dependsOn ? [...cmdInput.dependsOn] : [],
        });
      }
    });

    return ops;
  }

  /**
   * Continuous Dependency Resolver:
   * Infers exact fine-grained dependencies between operations so that independent
   * tasks can execute concurrently at t=0 while dependent tasks wait only on their
   * exact prerequisites. Preserves and merges any user-specified explicit dependencies.
   */
  public static resolveFineGrainedDependencies(ops: NormalizedOp[], baseDir: string = process.cwd()): NormalizedOp[] {
    // Map each file to its previous mutation task ID (write/edit)
    const fileLastMutation = new Map<string, string>();
    // Map each file to all active concurrent reader task IDs since last mutation
    const fileActiveReaders = new Map<string, Set<string>>();
    const mutationTaskIds: string[] = [];
    const manifestMutationIds: string[] = [];
    const setupCommandIds: string[] = [];

    for (const op of ops) {
      const deps = new Set<string>(op.dependsOn || []);

      if (op.type === "read") {
        const resolved = path.isAbsolute(op.path) ? op.path : path.resolve(baseDir, op.path);
        const lastMutation = fileLastMutation.get(resolved);
        // Read After Write (RAW): wait for prior mutation to complete
        if (lastMutation) {
          deps.add(lastMutation);
        }
        let readers = fileActiveReaders.get(resolved);
        if (!readers) {
          readers = new Set<string>();
          fileActiveReaders.set(resolved, readers);
        }
        readers.add(op.id);
      } else if (op.type === "write" || op.type === "edit") {
        const resolved = path.isAbsolute(op.path) ? op.path : path.resolve(baseDir, op.path);
        const lastMutation = fileLastMutation.get(resolved);
        // Write After Write (WAW): wait for prior mutation
        if (lastMutation) {
          deps.add(lastMutation);
        }
        // Write After Read (WAR): wait for ALL active prior concurrent readers
        const activeReaders = fileActiveReaders.get(resolved);
        if (activeReaders) {
          for (const readerId of activeReaders) {
            deps.add(readerId);
          }
          fileActiveReaders.delete(resolved);
        }
        fileLastMutation.set(resolved, op.id);
        mutationTaskIds.push(op.id);

        if (isManifestFile(op.path)) {
          manifestMutationIds.push(op.id);
        }
      } else if (op.type === "command") {
        if (isSetupCommand(op.command)) {
          // Setup commands only need to wait if package manifest files were modified
          for (const manifestId of manifestMutationIds) {
            deps.add(manifestId);
          }
          // Prior setup commands should finish before this setup command
          for (const prevSetup of setupCommandIds) {
            deps.add(prevSetup);
          }
          setupCommandIds.push(op.id);
        } else if (isVerificationCommand(op.command)) {
          // Verification commands (test, lint, tsc) wait for mutations and setup to complete
          for (const mutId of mutationTaskIds) {
            deps.add(mutId);
          }
          for (const setupId of setupCommandIds) {
            deps.add(setupId);
          }
          // Independent verification commands DO NOT depend on each other -> run in parallel!
        } else {
          // Generic commands wait for preceding mutations
          for (const mutId of mutationTaskIds) {
            deps.add(mutId);
          }
        }
      }

      op.dependsOn = Array.from(deps);
    }

    this.validateAcyclic(ops);
    return ops;
  }

  /**
   * Validates that the DAG contains no cycles.
   */
  public static validateAcyclic(ops: NormalizedOp[]): void {
    const taskMap = new Map<string, NormalizedOp>();
    for (const op of ops) {
      if (taskMap.has(op.id)) {
        throw new Error(`Duplicate task ID in parallel_execute: "${op.id}"`);
      }
      taskMap.set(op.id, op);
    }

    // Check for missing dependency IDs
    for (const op of ops) {
      for (const dep of op.dependsOn) {
        if (!taskMap.has(dep)) {
          throw new Error(`Task "${op.id}" depends on unknown task ID: "${dep}"`);
        }
      }
    }

    // Topological cycle detection (Kahn's Algorithm)
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    for (const op of ops) {
      inDegree.set(op.id, op.dependsOn.length);
      if (!graph.has(op.id)) graph.set(op.id, []);
    }

    for (const op of ops) {
      for (const dep of op.dependsOn) {
        if (!graph.has(dep)) graph.set(dep, []);
        graph.get(dep)!.push(op.id);
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
      const curr = queue.shift()!;
      visited++;
      for (const neighbor of graph.get(curr) || []) {
        const nextDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, nextDegree);
        if (nextDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (visited !== ops.length) {
      throw new Error("Circular dependency detected in execution graph!");
    }
  }
}
