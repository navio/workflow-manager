import type { JudgeVerdict } from "./judge.js";

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0)));
  const renderRow = (cells: string[]): string => ` ${cells.map((cell, column) => cell.padEnd(widths[column])).join("  ")}`.trimEnd();
  return [renderRow(headers), ...rows.map(renderRow)].join("\n");
}

export function renderJudgeReport(verdict: JudgeVerdict): string {
  const lines: string[] = [`Workflow: ${verdict.workflowKey}`, ""];

  if (verdict.steps.length > 0) {
    const rows = verdict.steps.map((step) => [
      step.stepKey,
      step.category,
      step.configuredModel ?? "(adapter default)",
      step.verdict,
      step.suggestedModel ? `→ ${step.suggestedModel}` : "",
    ]);
    lines.push(formatTable(["STEP", "CATEGORY", "MODEL", "VERDICT", "SUGGESTION"], rows), "");
    for (const step of verdict.steps) {
      if (step.reasoning && step.verdict !== "ok") {
        lines.push(` ${step.stepKey}: ${step.reasoning}`);
      }
    }
    lines.push("");
  } else {
    lines.push("No step verdicts returned.", "");
  }

  if (verdict.complexityFlags.length > 0) {
    lines.push("Complexity:");
    for (const flag of verdict.complexityFlags) {
      const scope = flag.stepKeys.length > 0 ? ` ${flag.stepKeys.join(", ")} —` : "";
      lines.push(` • [${flag.kind}]${scope} ${flag.suggestion}`);
    }
    lines.push("");
  }

  if (verdict.summary) {
    lines.push(`Summary: ${verdict.summary}`, "");
  }

  lines.push("Tip: re-run with --json and feed the output to your coding agent to apply changes.");
  return lines.join("\n");
}
