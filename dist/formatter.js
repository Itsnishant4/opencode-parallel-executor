export class ResultFormatter {
    static format(result) {
        const { summary, stages, rolledBack, dryRun } = result;
        const lines = [];
        // Header banner
        const statusIcon = summary.failed === 0 ? "⚡" : "⚠️";
        const modeTag = dryRun ? " [DRY-RUN]" : "";
        lines.push(`### ${statusIcon} Parallel Execution Report${modeTag}\n`);
        // Summary line
        lines.push(`**Summary:** ${summary.succeeded}/${summary.total} succeeded, ` +
            `${summary.failed} failed, ${summary.skipped} skipped ` +
            `across ${summary.stagesExecuted} stage(s) in **${summary.durationMs}ms**.`);
        if (rolledBack) {
            lines.push(`> 🛡️ **Rollback Triggered:** All modified files have been reverted to their original state.`);
        }
        lines.push("");
        // Stages
        for (const stage of stages) {
            lines.push(`#### Stage ${stage.stageIndex}: ${stage.stageName} ` +
                `(${stage.isParallel ? "Parallel" : "Sequential"}, ${stage.tasks.length} task(s), ${stage.durationMs}ms)`);
            for (const task of stage.tasks) {
                const icon = task.status === "success" ? "✓" : task.status === "failed" ? "✗" : "○";
                const tag = `[${task.type.toUpperCase()}]`;
                lines.push(`* ${icon} \`${task.id}\` ${tag} **${task.target}** (${task.durationMs}ms)`);
                if (task.error) {
                    lines.push(`  - **Error:** \`${task.error}\``);
                }
                if (task.output) {
                    if (task.type === "read") {
                        // Display read content
                        lines.push("  ```text");
                        lines.push(task.output);
                        lines.push("  ```");
                    }
                    else if (task.type === "command") {
                        lines.push("  ```bash");
                        lines.push(task.output);
                        lines.push("  ```");
                    }
                    else {
                        lines.push(`  - ${task.output}`);
                    }
                }
            }
            lines.push("");
        }
        return lines.join("\n").trim();
    }
}
//# sourceMappingURL=formatter.js.map