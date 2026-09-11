import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { FastBashRunner } from "./fast-bash.js";
export const VerifyArgsSchema = {
    type: z.enum(["typecheck", "lint", "all"]).optional().default("all").describe("Type of verification to run (default: all)"),
    path: z.string().optional().describe("Specific subproject directory or file to verify"),
    fix: z.boolean().optional().default(false).describe("Attempt automatic fixes if linter supports it (e.g. eslint --fix)"),
};
export class CodebaseVerifier {
    baseDir;
    bashRunner;
    constructor(baseDir = process.cwd()) {
        this.baseDir = path.resolve(baseDir);
        this.bashRunner = new FastBashRunner(this.baseDir);
    }
    async fileExists(filePath) {
        try {
            await fs.stat(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    async detectChecks(targetDir, type, fix) {
        const checks = [];
        const pkgJsonPath = path.join(targetDir, "package.json");
        const tsconfigPath = path.join(targetDir, "tsconfig.json");
        const pyprojectPath = path.join(targetDir, "pyproject.toml");
        const cargoPath = path.join(targetDir, "Cargo.toml");
        const goModPath = path.join(targetDir, "go.mod");
        let pkgScripts = {};
        if (await this.fileExists(pkgJsonPath)) {
            try {
                const raw = await fs.readFile(pkgJsonPath, "utf-8");
                const parsed = JSON.parse(raw);
                pkgScripts = parsed.scripts || {};
            }
            catch {
                // Ignore JSON parse errors
            }
        }
        // 1. TypeScript / Node Checks
        if (await this.fileExists(tsconfigPath) || Object.keys(pkgScripts).length > 0) {
            if (type === "all" || type === "typecheck") {
                if (pkgScripts.typecheck) {
                    checks.push({ name: "TypeScript Typecheck", command: "npm run typecheck" });
                }
                else if (await this.fileExists(tsconfigPath)) {
                    checks.push({ name: "TypeScript Typecheck", command: "npx tsc --noEmit" });
                }
            }
            if (type === "all" || type === "lint") {
                if (pkgScripts.lint) {
                    const cmd = fix ? "npm run lint -- --fix" : "npm run lint";
                    checks.push({ name: "Linter", command: cmd });
                }
                else if (pkgScripts.check) {
                    checks.push({ name: "Project Check", command: "npm run check" });
                }
            }
        }
        // 2. Python Checks
        if (await this.fileExists(pyprojectPath) || await this.fileExists(path.join(targetDir, "setup.py")) || await this.fileExists(path.join(targetDir, "requirements.txt"))) {
            if (type === "all" || type === "typecheck") {
                if (await this.fileExists(path.join(targetDir, "mypy.ini")) || await this.fileExists(path.join(targetDir, ".mypy.ini"))) {
                    checks.push({ name: "Python Typecheck (mypy)", command: "mypy ." });
                }
                else if (await this.fileExists(path.join(targetDir, "pyrightconfig.json"))) {
                    checks.push({ name: "Python Typecheck (pyright)", command: "pyright" });
                }
            }
            if (type === "all" || type === "lint") {
                if (await this.fileExists(path.join(targetDir, "ruff.toml")) || await this.fileExists(path.join(targetDir, ".ruff.toml"))) {
                    const cmd = fix ? "ruff check --fix ." : "ruff check .";
                    checks.push({ name: "Python Linter (ruff)", command: cmd });
                }
                else if (await this.fileExists(path.join(targetDir, ".flake8"))) {
                    checks.push({ name: "Python Linter (flake8)", command: "flake8 ." });
                }
            }
        }
        // 3. Rust Checks
        if (await this.fileExists(cargoPath)) {
            if (type === "all" || type === "typecheck") {
                checks.push({ name: "Rust Cargo Check", command: "cargo check --message-format=short" });
            }
            if (type === "all" || type === "lint") {
                checks.push({ name: "Rust Clippy", command: "cargo clippy --message-format=short" });
            }
        }
        // 4. Go Checks
        if (await this.fileExists(goModPath)) {
            if (type === "all" || type === "typecheck") {
                checks.push({ name: "Go Vet", command: "go vet ./..." });
            }
        }
        return checks;
    }
    parseDiagnostics(rawOutput, checkName) {
        const diagnostics = [];
        const lines = rawOutput.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            // 1. TypeScript standard: path/file.ts(line,col): error TS1234: Message
            let m = trimmed.match(/^([^\s(]+)\(([0-9]+),([0-9]+)\):\s*(error|warning)\s+(TS[0-9]+):\s*(.*)$/i);
            if (m) {
                diagnostics.push({
                    file: m[1],
                    line: parseInt(m[2], 10),
                    col: parseInt(m[3], 10),
                    severity: m[4].toLowerCase(),
                    code: m[5],
                    message: m[6].trim(),
                });
                continue;
            }
            // 2. TypeScript alternative: path/file.ts:line:col - error TS1234: Message
            m = trimmed.match(/^([^\s:]+):([0-9]+):([0-9]+)\s*-\s*(error|warning)\s+(TS[0-9]+):\s*(.*)$/i);
            if (m) {
                diagnostics.push({
                    file: m[1],
                    line: parseInt(m[2], 10),
                    col: parseInt(m[3], 10),
                    severity: m[4].toLowerCase(),
                    code: m[5],
                    message: m[6].trim(),
                });
                continue;
            }
            // 3. ESLint: line:col error Message rule-name
            m = trimmed.match(/^\s*([0-9]+):([0-9]+)\s+(error|warning)\s+(.*?)(?:\s{2,}([a-zA-Z0-9\-_/]+))?$/i);
            if (m) {
                diagnostics.push({
                    file: "(current file)",
                    line: parseInt(m[1], 10),
                    col: parseInt(m[2], 10),
                    severity: m[3].toLowerCase(),
                    code: m[5] || "",
                    message: m[4].trim(),
                });
                continue;
            }
            // 4. Python / Rust / GCC: path/file:line:col: error: Message
            m = trimmed.match(/^([^\s:]+):([0-9]+):(?:([0-9]+):)?\s*(error|warning):\s*(.*)$/i);
            if (m) {
                diagnostics.push({
                    file: m[1],
                    line: parseInt(m[2], 10),
                    col: m[3] ? parseInt(m[3], 10) : undefined,
                    severity: m[4].toLowerCase(),
                    message: m[5].trim(),
                });
                continue;
            }
            // 5. Ruff / Flake8 style: path/file.py:line:col: CODE message
            const ruffMatch = trimmed.match(/^([^\s:]+\.py):([0-9]+):([0-9]+):\s*([A-Z][0-9]+)\s*(?:\[\*\]\s*)?(.*)$/);
            if (ruffMatch) {
                diagnostics.push({
                    file: ruffMatch[1],
                    line: parseInt(ruffMatch[2], 10),
                    col: parseInt(ruffMatch[3], 10),
                    severity: "error",
                    code: ruffMatch[4],
                    message: ruffMatch[5].trim(),
                });
                continue;
            }
            // 6. Go compiler: ./main.go:line:col: message
            const goMatch = trimmed.match(/^(\.?[^\s:]+\.go):([0-9]+):([0-9]+):\s*(.*)$/);
            if (goMatch) {
                diagnostics.push({
                    file: goMatch[1],
                    line: parseInt(goMatch[2], 10),
                    col: parseInt(goMatch[3], 10),
                    severity: "error",
                    message: goMatch[4].trim(),
                });
                continue;
            }
            // 7. Rust error[E0xxx]:
            const rustMatch = trimmed.match(/^error(?:\[(E[0-9]+)\])?:\s*(.*)$/);
            if (rustMatch) {
                diagnostics.push({
                    file: "(rust build)",
                    line: 1,
                    severity: "error",
                    code: rustMatch[1],
                    message: rustMatch[2].trim(),
                });
                continue;
            }
        }
        return diagnostics;
    }
    async verify(args = {}, sessionDir, abortSignal) {
        const t0 = performance.now();
        const root = sessionDir ? path.resolve(sessionDir) : this.baseDir;
        const effectiveDir = args.path ? path.resolve(root, args.path) : root;
        const checks = await this.detectChecks(effectiveDir, args.type || "all", args.fix || false);
        if (checks.length === 0) {
            return `⚠️ **verify**: No supported test, linter, or typechecker configuration detected in \`${path.basename(effectiveDir)}\`.`;
        }
        // Execute checks in parallel lanes
        const results = await Promise.all(checks.map(async (check) => {
            const checkStart = performance.now();
            const res = await this.bashRunner.execute(check.command, effectiveDir, 45000, abortSignal);
            const durationMs = Math.round(performance.now() - checkStart);
            const combinedOut = (res.stdout + "\n" + res.stderr).trim();
            const diagnostics = this.parseDiagnostics(combinedOut, check.name);
            return {
                name: check.name,
                command: check.command,
                exitCode: res.exitCode,
                durationMs,
                diagnostics,
                rawOutput: combinedOut,
            };
        }));
        const totalDuration = Math.round(performance.now() - t0);
        const allPassed = results.every((r) => r.exitCode === 0);
        const allDiagnostics = [];
        results.forEach((r) => allDiagnostics.push(...r.diagnostics));
        if (allPassed) {
            let out = `✓ **All ${results.length} verification check(s) passed cleanly!** (${totalDuration}ms)\n\n`;
            out += "| Check | Command | Status | Duration |\n";
            out += "| :--- | :--- | :---: | ---: |\n";
            results.forEach((r) => {
                out += `| ${r.name} | \`${r.command}\` | PASS | ${r.durationMs}ms |\n`;
            });
            return out;
        }
        // Failures detected
        const totalErrors = allDiagnostics.filter((d) => d.severity === "error").length;
        const totalWarnings = allDiagnostics.filter((d) => d.severity === "warning").length;
        let out = `❌ **Verification Failed: ${totalErrors} error(s), ${totalWarnings} warning(s)** across ${results.length} check(s) in ${totalDuration}ms\n\n`;
        out += "| Check | Command | Exit | Errors | Warnings |\n";
        out += "| :--- | :--- | :---: | :---: | :---: |\n";
        results.forEach((r) => {
            const errCount = r.diagnostics.filter((d) => d.severity === "error").length;
            const warnCount = r.diagnostics.filter((d) => d.severity === "warning").length;
            const statusIcon = r.exitCode === 0 ? "✓ 0" : `❌ ${r.exitCode}`;
            out += `| ${r.name} | \`${r.command}\` | ${statusIcon} | ${errCount} | ${warnCount} |\n`;
        });
        if (allDiagnostics.length > 0) {
            out += "\n### 🔍 Diagnostics:\n\n";
            out += "| File | Line:Col | Severity | Code | Message |\n";
            out += "| :--- | :---: | :---: | :---: | :--- |\n";
            const displayDiag = allDiagnostics.slice(0, 30);
            displayDiag.forEach((d) => {
                const loc = d.col ? `${d.line}:${d.col}` : `${d.line}`;
                const codeStr = d.code ? `\`${d.code}\`` : "·";
                const sevTag = d.severity === "error" ? "🛑 ERROR" : "⚠️ WARN";
                out += `| \`${d.file}\` | ${loc} | ${sevTag} | ${codeStr} | ${d.message} |\n`;
            });
            if (allDiagnostics.length > 30) {
                out += `\n*... and ${allDiagnostics.length - 30} more diagnostics omitted for brevity.*\n`;
            }
        }
        // Always display raw output for failed checks that didn't yield structured diagnostics
        const unparsedFailures = results.filter((r) => r.exitCode !== 0 && r.diagnostics.length === 0);
        if (unparsedFailures.length > 0) {
            out += "\n### 📋 Unparsed Command Output:\n";
            unparsedFailures.forEach((r) => {
                const head = r.rawOutput.split("\n").slice(0, 25).join("\n");
                out += `\n**${r.name}**:\n\`\`\`text\n${head}\n\`\`\`\n`;
            });
        }
        return out;
    }
}
//# sourceMappingURL=verifier.js.map