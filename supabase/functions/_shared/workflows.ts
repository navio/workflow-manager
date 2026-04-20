import { HttpError } from "./responses.ts";

const supportedAdapters = new Set(["mock", "opencode", "codex", "claude-code"]);
const supportedValidationModes = new Set(["none", "human", "external"]);
const supportedSourceFormats = new Set(["markdown", "json"]);
const supportedVisibility = new Set(["public", "private"]);
const supportedPublishedStates = new Set(["draft", "published"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeString(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new HttpError(400, `Missing required field: ${field}`);
  }

  return normalized;
}

export function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

export function normalizeVisibility(value: unknown): "public" | "private" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "private";
  if (!supportedVisibility.has(normalized)) {
    throw new HttpError(400, "visibility must be 'public' or 'private'");
  }

  return normalized as "public" | "private";
}

export function normalizePublishedState(value: unknown): "draft" | "published" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "published";
  if (!supportedPublishedStates.has(normalized)) {
    throw new HttpError(400, "publishedState must be 'draft' or 'published'");
  }

  return normalized as "draft" | "published";
}

export function normalizeSourceFormat(value: unknown): "markdown" | "json" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!supportedSourceFormats.has(normalized)) {
    throw new HttpError(400, "sourceFormat must be 'markdown' or 'json'");
  }

  return normalized as "markdown" | "json";
}

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

export function validateWorkflowDefinition(value: unknown): string[] {
  const workflow = asRecord(value);
  const errors: string[] = [];
  const key = typeof workflow.key === "string" ? workflow.key.trim() : "";
  const title = typeof workflow.title === "string" ? workflow.title.trim() : "";
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];

  if (!key) {
    errors.push("Workflow definition must include a key");
  }
  if (!title) {
    errors.push("Workflow definition must include a title");
  }
  if (!Array.isArray(workflow.steps)) {
    errors.push("Workflow definition must include steps");
    return errors;
  }

  const seenStepKeys = new Set<string>();
  const stepKeys = new Set<string>();
  for (const stepValue of steps) {
    const step = asRecord(stepValue);
    const stepKey = typeof step.key === "string" ? step.key.trim() : "";
    if (stepKey) {
      stepKeys.add(stepKey);
    }
  }

  for (const stepValue of steps) {
    const step = asRecord(stepValue);
    const stepKey = typeof step.key === "string" ? step.key.trim() : "";
    if (!stepKey) {
      errors.push("Every step must include a key");
      continue;
    }
    if (seenStepKeys.has(stepKey)) {
      errors.push(`Duplicate step key: ${stepKey}`);
    }
    seenStepKeys.add(stepKey);

    const dependsOn = Array.isArray(step.dependsOn) ? step.dependsOn : [];
    for (const dependency of dependsOn) {
      if (!stepKeys.has(String(dependency))) {
        errors.push(`Step ${stepKey} depends on missing step ${String(dependency)}`);
      }
    }

    const validation = asRecord(step.validation);
    if (validation.mode && !supportedValidationModes.has(String(validation.mode))) {
      errors.push(`Unsupported validation mode on step ${stepKey}: ${String(validation.mode)}`);
    }

    const taskSpec = asRecord(step.taskSpec);
    if (taskSpec.adapterKey && !supportedAdapters.has(String(taskSpec.adapterKey))) {
      errors.push(`Unsupported adapter on step ${stepKey}: ${String(taskSpec.adapterKey)}`);
    }
  }

  return errors;
}
