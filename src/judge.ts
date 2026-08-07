import { resolveTaskAdapter } from "./adapters.js";
import type { StepDefinition, WorkflowDefinition } from "./types.js";

const TRUNCATE_AT = 500;

function truncate(text: string): string {
  if (text.length <= TRUNCATE_AT) {
    return text;
  }
  return `${text.slice(0, TRUNCATE_AT)}… [truncated, ${text.length} chars total]`;
}

export interface StepDigest {
  key: string;
  kind: string;
  title?: string;
  objective?: string;
  /** Resolved adapter for task steps; "approval"/"system" for non-task steps. */
  adapterKey: string;
  model?: string;
  dependsOn: string[];
  stateFrom?: "all" | "none" | string[];
  skills: string[];
  systemPromptCount: number;
  systemPromptChars: number;
  contextChars: number;
}

export interface WorkflowDigest {
  key: string;
  title: string;
  description?: string;
  objectives: string[];
  stepCount: number;
  steps: StepDigest[];
}

function digestStep(step: StepDefinition): StepDigest {
  const init = step.taskSpec?.init;
  const systemPrompts = init?.systemPrompts ?? [];
  const context = init?.context;
  const contextChars = typeof context === "string" ? context.length : context ? JSON.stringify(context).length : 0;

  return {
    key: step.key,
    kind: step.kind,
    title: step.title,
    objective: step.objective ? truncate(step.objective) : undefined,
    adapterKey: step.kind === "task" ? resolveTaskAdapter(step.taskSpec?.adapterKey) : step.kind === "approval" ? "approval" : "system",
    model: init?.model,
    dependsOn: step.dependsOn ?? [],
    stateFrom: init?.stateFrom,
    skills: init?.skills ?? [],
    systemPromptCount: systemPrompts.length,
    systemPromptChars: systemPrompts.reduce((sum, prompt) => sum + prompt.length, 0),
    contextChars,
  };
}

export function buildWorkflowDigest(workflow: WorkflowDefinition): WorkflowDigest {
  return {
    key: workflow.key,
    title: workflow.title,
    description: workflow.description ? truncate(workflow.description) : undefined,
    objectives: (workflow.objectives ?? []).map(truncate),
    stepCount: workflow.steps.length,
    steps: workflow.steps.map(digestStep),
  };
}
