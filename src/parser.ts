import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { AdapterKey, SkillEntry, WorkflowDefinition } from "./types.js";

const SUPPORTED_ADAPTERS: AdapterKey[] = ["mock", "opencode", "codex", "claude-code"];
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

function validateSkillEntry(name: string, entry: SkillEntry, errors: string[]): void {
  if (!isSafeSkillName(name)) {
    errors.push(`Invalid skill name: ${name}`);
  }

  if (!entry.content?.trim() && !entry.source?.trim()) {
    errors.push(`Skill "${name}" must define content or source`);
  }

  if (entry.source && !isAllowedLocalSkillSourcePath(entry.source)) {
    errors.push(`Skill "${name}" source must be under ./skills/**/SKILL.md`);
  }

  if (entry.contentSha256) {
    if (!/^[a-f0-9]{64}$/.test(entry.contentSha256)) {
      errors.push(`Skill "${name}" contentSha256 must be a 64-char lowercase hex SHA-256`);
    } else if (!entry.content?.trim()) {
      errors.push(`Skill "${name}" defines contentSha256 but has no content`);
    } else if (hashContentSha256(entry.content) !== entry.contentSha256) {
      errors.push(`Skill "${name}" contentSha256 does not match content`);
    }
  }

  if (entry.upstream) {
    if (entry.upstream.repo !== undefined && (!entry.upstream.repo || typeof entry.upstream.repo !== "string")) {
      errors.push(`Skill "${name}" upstream.repo must be a non-empty string when present`);
    }
    if (entry.upstream.ref !== undefined && (!entry.upstream.ref || typeof entry.upstream.ref !== "string")) {
      errors.push(`Skill "${name}" upstream.ref must be a non-empty string when present`);
    }
    if (entry.upstream.path !== undefined && (!entry.upstream.path || typeof entry.upstream.path !== "string")) {
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

  for (const [name, entry] of Object.entries(def.skills ?? {})) {
    validateSkillEntry(name, entry, errors);
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
