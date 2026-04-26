import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { AdapterKey, WorkflowDefinition } from "./types.js";

const SUPPORTED_ADAPTERS: AdapterKey[] = ["mock", "opencode", "codex", "claude-code"];

function normalizeWorkflow(data: Partial<WorkflowDefinition>, source: string): WorkflowDefinition {
  if (!data.key || !data.title || !Array.isArray(data.steps)) {
    throw new Error(`Invalid workflow ${source}: key, title, and steps are required`);
  }

  return {
    key: data.key,
    title: data.title,
    description: data.description,
    objectives: data.objectives ?? [],
    inputSchema: data.inputSchema ?? {},
    outputSchema: data.outputSchema ?? {},
    defaultRetryPolicy: data.defaultRetryPolicy ?? { maxAttempts: 1 },
    skills: data.skills,
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

export function parseWorkflowMarkdown(filePath: string): WorkflowDefinition {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  const data = parsed.data as Partial<WorkflowDefinition>;

  return normalizeWorkflow(data, "markdown");
}

export function parseWorkflowJson(filePath: string): WorkflowDefinition {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as Partial<WorkflowDefinition>;

  return normalizeWorkflow(data, "json");
}

export function parseWorkflowFile(filePath: string): WorkflowDefinition {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".json") {
    return parseWorkflowJson(filePath);
  }

  return parseWorkflowMarkdown(filePath);
}

export function validateWorkflow(def: WorkflowDefinition): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  if (!def.key.trim()) {
    errors.push("Workflow key is required");
  }

  if (!def.title.trim()) {
    errors.push("Workflow title is required");
  }

  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    errors.push("Workflow must define at least one step");
    return errors;
  }

  for (const step of def.steps) {
    if (!step.key || !step.key.trim()) {
      errors.push("Each step must define a non-empty key");
      continue;
    }

    if (seen.has(step.key)) errors.push(`Duplicate step key: ${step.key}`);
    seen.add(step.key);

    if (!["task", "approval", "system"].includes(step.kind)) {
      errors.push(`Invalid step kind for ${step.key}: ${step.kind}`);
    }

    if (step.kind === "task" && !step.taskSpec) {
      errors.push(`Task step ${step.key} is missing taskSpec`);
    }

    if (step.kind === "approval" && !step.approvalSpec) {
      errors.push(`Approval step ${step.key} is missing approvalSpec`);
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
