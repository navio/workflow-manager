import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { AdapterKey, SkillEntry, StepDefinition, ValidationMode, WorkflowDefinition } from "./types.js";

const SUPPORTED_ADAPTERS: AdapterKey[] = ["mock", "opencode", "codex", "claude-code"];
const SUPPORTED_STEP_KINDS = ["task", "approval", "system"];
const SUPPORTED_VALIDATION_MODES: ValidationMode[] = ["none", "human", "external"];
const SKILL_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

function hashContentSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isSafeSkillName(name: string): boolean {
  return !!name && SKILL_NAME_PATTERN.test(name);
}

function isAllowedLocalSkillSourcePath(source: string): boolean {
  if (!source || path.isAbsolute(source) || source.includes("\\") || source.includes("..")) return false;
  const normalized = path.posix.normalize(source);
  const withoutDot = normalized.startsWith("./") ? normalized.slice(2) : normalized;
  if (!withoutDot.startsWith("skills/")) return false;
  return withoutDot.endsWith("/SKILL.md");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateStringArray(value: unknown, label: string, errors: string[]): value is string[] {
  if (value === undefined) {
    return true;
  }

  if (!isStringArray(value)) {
    errors.push(`${label} must be an array of strings`);
    return false;
  }

  return true;
}

function validateValidationSpec(value: unknown, label: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }

  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }

  const mode = value.mode;
  if (mode !== undefined && (typeof mode !== "string" || !SUPPORTED_VALIDATION_MODES.includes(mode as ValidationMode))) {
    errors.push(`${label}.mode must be one of ${SUPPORTED_VALIDATION_MODES.join(", ")}`);
  }

  for (const key of ["required", "autoConfirm"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      errors.push(`${label}.${key} must be a boolean`);
    }
  }

  if (value.confirmerPolicy !== undefined && !hasNonEmptyString(value.confirmerPolicy)) {
    errors.push(`${label}.confirmerPolicy must be a non-empty string when present`);
  }
}

function validateRetryPolicy(value: unknown, label: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }

  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }

  if (value.maxAttempts !== undefined) {
    if (!Number.isInteger(value.maxAttempts) || Number(value.maxAttempts) < 1) {
      errors.push(`${label}.maxAttempts must be a positive integer`);
    }
  }
}

function validateSkillEntry(name: string, entry: unknown, errors: string[]): void {
  if (!isSafeSkillName(name)) {
    errors.push(`Invalid skill name: ${name}`);
  }

  if (!isPlainObject(entry)) {
    errors.push(`Skill "${name}" must be an object`);
    return;
  }

  const skill = entry as SkillEntry;
  const content = typeof skill.content === "string" ? skill.content : undefined;
  const source = typeof skill.source === "string" ? skill.source : undefined;
  const contentSha256 = typeof skill.contentSha256 === "string" ? skill.contentSha256 : undefined;

  if (skill.content !== undefined && typeof skill.content !== "string") {
    errors.push(`Skill "${name}" content must be a string when present`);
  }

  if (skill.source !== undefined && typeof skill.source !== "string") {
    errors.push(`Skill "${name}" source must be a string when present`);
  }

  if (!content?.trim() && !source?.trim()) {
    errors.push(`Skill "${name}" must define content or source`);
  }

  if (source && !isAllowedLocalSkillSourcePath(source)) {
    errors.push(`Skill "${name}" source must be under ./skills/**/SKILL.md`);
  }

  if (skill.contentSha256 !== undefined && typeof skill.contentSha256 !== "string") {
    errors.push(`Skill "${name}" contentSha256 must be a string when present`);
  }

  if (contentSha256) {
    if (!/^[a-f0-9]{64}$/.test(contentSha256)) {
      errors.push(`Skill "${name}" contentSha256 must be a 64-char lowercase hex SHA-256`);
    } else if (!content?.trim()) {
      errors.push(`Skill "${name}" defines contentSha256 but has no content`);
    } else if (hashContentSha256(content) !== contentSha256) {
      errors.push(`Skill "${name}" contentSha256 does not match content`);
    }
  }

  if (skill.upstream !== undefined) {
    if (!isPlainObject(skill.upstream)) {
      errors.push(`Skill "${name}" upstream must be an object when present`);
      return;
    }

    if (skill.upstream.repo !== undefined && !hasNonEmptyString(skill.upstream.repo)) {
      errors.push(`Skill "${name}" upstream.repo must be a non-empty string when present`);
    }
    if (skill.upstream.ref !== undefined && !hasNonEmptyString(skill.upstream.ref)) {
      errors.push(`Skill "${name}" upstream.ref must be a non-empty string when present`);
    }
    if (skill.upstream.path !== undefined && !hasNonEmptyString(skill.upstream.path)) {
      errors.push(`Skill "${name}" upstream.path must be a non-empty string when present`);
    }
  }
}

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
  const workflow = def as Partial<WorkflowDefinition>;

  if (!hasNonEmptyString(workflow.key)) {
    errors.push("Workflow key is required");
  }

  if (!hasNonEmptyString(workflow.title)) {
    errors.push("Workflow title is required");
  }

  if (workflow.objectives !== undefined && !isStringArray(workflow.objectives)) {
    errors.push("Workflow objectives must be an array of strings");
  }

  validateRetryPolicy(workflow.defaultRetryPolicy, "defaultRetryPolicy", errors);

  if (workflow.skills !== undefined) {
    if (!isPlainObject(workflow.skills)) {
      errors.push("Workflow skills must be an object");
    } else {
      for (const [name, entry] of Object.entries(workflow.skills)) {
        validateSkillEntry(name, entry, errors);
      }
    }
  }

  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push("Workflow must define at least one step");
    return errors;
  }

  const stepKeys = new Set(
    workflow.steps
      .filter((step): step is StepDefinition => isPlainObject(step) && hasNonEmptyString(step.key))
      .map((step) => step.key)
  );

  for (const step of workflow.steps) {
    if (!isPlainObject(step)) {
      errors.push("Each step must be an object");
      continue;
    }

    if (!hasNonEmptyString(step.key)) {
      errors.push("Each step must define a non-empty key");
      continue;
    }

    if (seen.has(step.key)) errors.push(`Duplicate step key: ${step.key}`);
    seen.add(step.key);

    if (typeof step.kind !== "string" || !SUPPORTED_STEP_KINDS.includes(step.kind)) {
      errors.push(`Invalid step kind for ${step.key}: ${step.kind}`);
    }

    if (step.kind === "task" && !step.taskSpec) {
      errors.push(`Task step ${step.key} is missing taskSpec`);
    } else if (step.taskSpec !== undefined && !isPlainObject(step.taskSpec)) {
      errors.push(`Task spec for ${step.key} must be an object`);
    }

    if (step.kind === "approval" && !step.approvalSpec) {
      errors.push(`Approval step ${step.key} is missing approvalSpec`);
    } else if (step.approvalSpec !== undefined && !isPlainObject(step.approvalSpec)) {
      errors.push(`Approval spec for ${step.key} must be an object`);
    }

    validateRetryPolicy(step.retryPolicy, `Retry policy for ${step.key}`, errors);
    validateValidationSpec(step.validation, `Validation for ${step.key}`, errors);

    if (step.dependsOn !== undefined && !isStringArray(step.dependsOn)) {
      errors.push(`Step ${step.key} dependsOn must be an array of strings`);
    } else {
      for (const dep of step.dependsOn ?? []) {
        if (!stepKeys.has(dep)) {
          errors.push(`Step ${step.key} depends on unknown step ${dep}`);
        }
      }
    }

    const taskSpec = isPlainObject(step.taskSpec) ? step.taskSpec : undefined;
    const adapter = taskSpec?.adapterKey;
    if (adapter !== undefined && (typeof adapter !== "string" || !SUPPORTED_ADAPTERS.includes(adapter as AdapterKey))) {
      errors.push(`Unsupported adapter for ${step.key}: ${adapter}`);
    }

    if (taskSpec?.capabilityRequirements !== undefined) {
      validateStringArray(taskSpec.capabilityRequirements, `Capability requirements for ${step.key}`, errors);
    }

    if (taskSpec?.init !== undefined) {
      if (!isPlainObject(taskSpec.init)) {
        errors.push(`Task init for ${step.key} must be an object`);
      } else {
        validateStringArray(taskSpec.init.skills, `Task init skills for ${step.key}`, errors);
        validateStringArray(taskSpec.init.mcps, `Task init mcps for ${step.key}`, errors);
        validateStringArray(taskSpec.init.systemPrompts, `Task init systemPrompts for ${step.key}`, errors);
        if (taskSpec.init.model !== undefined && !hasNonEmptyString(taskSpec.init.model)) {
          errors.push(`Task init model for ${step.key} must be a non-empty string when present`);
        }
      }
    }

    if (taskSpec?.payload !== undefined && !isPlainObject(taskSpec.payload)) {
      errors.push(`Task payload for ${step.key} must be an object`);
    }

    const approvalSpec = isPlainObject(step.approvalSpec) ? step.approvalSpec : undefined;
    if (approvalSpec?.autoApprove !== undefined && typeof approvalSpec.autoApprove !== "boolean") {
      errors.push(`Approval autoApprove for ${step.key} must be a boolean`);
    }
    if (approvalSpec?.approverPolicy !== undefined && !hasNonEmptyString(approvalSpec.approverPolicy)) {
      errors.push(`Approval approverPolicy for ${step.key} must be a non-empty string when present`);
    }
    validateValidationSpec(approvalSpec?.validation, `Approval validation for ${step.key}`, errors);
  }

  return errors;
}
