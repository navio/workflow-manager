import fs from "node:fs";
import matter from "gray-matter";
import type { AdapterKey, WorkflowDefinition } from "./types.js";

const SUPPORTED_ADAPTERS: AdapterKey[] = ["mock", "opencode", "codex", "claude-code"];

export function parseWorkflowMarkdown(filePath: string): WorkflowDefinition {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  const data = parsed.data as Partial<WorkflowDefinition>;

  if (!data.key || !data.title || !Array.isArray(data.steps)) {
    throw new Error("Invalid workflow markdown: key, title, and steps are required in frontmatter");
  }

  return {
    key: data.key,
    title: data.title,
    description: data.description,
    objectives: data.objectives ?? [],
    inputSchema: data.inputSchema ?? {},
    outputSchema: data.outputSchema ?? {},
    defaultRetryPolicy: data.defaultRetryPolicy ?? { maxAttempts: 1 },
    steps: data.steps.map((s) => ({
      ...s,
      dependsOn: s.dependsOn ?? [],
      retryPolicy: s.retryPolicy ?? data.defaultRetryPolicy ?? { maxAttempts: 1 },
      validation: s.validation ?? { mode: "none", required: false, autoConfirm: true },
      taskSpec: s.taskSpec
        ? {
            ...s.taskSpec,
            adapterKey: (s.taskSpec.adapterKey ?? "mock") as AdapterKey,
            init: {
              context: s.taskSpec.init?.context ?? {},
              skills: s.taskSpec.init?.skills ?? [],
              mcps: s.taskSpec.init?.mcps ?? [],
              systemPrompts: s.taskSpec.init?.systemPrompts ?? [],
              model: s.taskSpec.init?.model,
            },
          }
        : undefined,
    })),
  };
}

export function validateWorkflow(def: WorkflowDefinition): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const step of def.steps) {
    if (seen.has(step.key)) errors.push(`Duplicate step key: ${step.key}`);
    seen.add(step.key);

    if (!["task", "approval", "system"].includes(step.kind)) {
      errors.push(`Invalid step kind for ${step.key}: ${step.kind}`);
    }

    for (const dep of step.dependsOn ?? []) {
      if (!def.steps.some((s) => s.key === dep)) {
        errors.push(`Step ${step.key} depends on unknown step ${dep}`);
      }
    }

    const adapter = step.taskSpec?.adapterKey;
    if (adapter && !SUPPORTED_ADAPTERS.includes(adapter)) {
      errors.push(`Unsupported adapter for ${step.key}: ${adapter}`);
    }

    const mode = step.validation?.mode ?? step.approvalSpec?.validation?.mode;
    if (mode && !["none", "human", "external"].includes(mode)) {
      errors.push(`Invalid validation mode for ${step.key}: ${mode}`);
    }
  }

  return errors;
}
