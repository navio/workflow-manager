import { resolveTaskAdapter } from "./adapters.js";
import type { StepDefinition, WorkflowDefinition } from "./types.js";
import type { TaskCategory } from "./modelCatalog.js";
import type { OutputEnvelope } from "./types.js";

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

export interface StepVerdict {
  stepKey: string;
  category: TaskCategory;
  configuredModel?: string;
  verdict: "ok" | "overkill" | "underpowered" | "unknown";
  suggestedModel?: string;
  reasoning: string;
}

export interface ComplexityFlag {
  kind: "step-too-broad" | "missing-state-scoping" | "context-bloat" | "redundant-step" | "unclear-objective" | "other";
  stepKeys: string[];
  suggestion: string;
}

export interface JudgeVerdict {
  workflowKey: string;
  steps: StepVerdict[];
  complexityFlags: ComplexityFlag[];
  summary: string;
}

const TASK_CATEGORIES: readonly string[] = ["coding", "general", "retrieval", "review", "orchestration", "summarization"];
const STEP_VERDICT_VALUES: readonly string[] = ["ok", "overkill", "underpowered", "unknown"];
const FLAG_KINDS: readonly string[] = [
  "step-too-broad",
  "missing-state-scoping",
  "context-bloat",
  "redundant-step",
  "unclear-objective",
  "other",
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function extractFirstJsonObject(text: string): unknown {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") {
          i++;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break; // malformed candidate; try the next opening brace
          }
        }
      }
    }
  }
  return undefined;
}

export function extractVerdictCandidate(output: OutputEnvelope): unknown {
  const payload = asRecord(output.mutated_payload);
  const direct = payload.judgeVerdict;
  if (direct && typeof direct === "object") {
    return direct;
  }
  if (typeof direct === "string") {
    return extractFirstJsonObject(direct);
  }
  for (const value of Object.values(payload)) {
    if (typeof value === "string" && value.includes('"steps"')) {
      const parsed = extractFirstJsonObject(value);
      if (Array.isArray(asRecord(parsed).steps)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function coerceStepVerdict(raw: unknown, knownStepKeys: Set<string>): StepVerdict | null {
  const record = asRecord(raw);
  const stepKey = typeof record.stepKey === "string" ? record.stepKey : "";
  if (!knownStepKeys.has(stepKey)) {
    if (stepKey) {
      process.stderr.write(`[wfm judge] dropping verdict for unknown step "${stepKey}"\n`);
    }
    return null;
  }
  const category = typeof record.category === "string" && TASK_CATEGORIES.includes(record.category) ? record.category : "general";
  const verdict =
    typeof record.verdict === "string" && STEP_VERDICT_VALUES.includes(record.verdict) ? record.verdict : "unknown";
  return {
    stepKey,
    category: category as TaskCategory,
    configuredModel: typeof record.configuredModel === "string" ? record.configuredModel : undefined,
    verdict: verdict as StepVerdict["verdict"],
    suggestedModel: typeof record.suggestedModel === "string" ? record.suggestedModel : undefined,
    reasoning: typeof record.reasoning === "string" ? record.reasoning : "",
  };
}

function coerceComplexityFlag(raw: unknown): ComplexityFlag | null {
  const record = asRecord(raw);
  const suggestion = typeof record.suggestion === "string" ? record.suggestion : "";
  if (!suggestion) {
    return null;
  }
  return {
    kind: (typeof record.kind === "string" && FLAG_KINDS.includes(record.kind) ? record.kind : "other") as ComplexityFlag["kind"],
    stepKeys: Array.isArray(record.stepKeys) ? record.stepKeys.filter((key): key is string => typeof key === "string") : [],
    suggestion,
  };
}

export function parseJudgeVerdict(raw: unknown, workflow: WorkflowDefinition): JudgeVerdict | string {
  const record = asRecord(raw);
  if (!Array.isArray(record.steps)) {
    return "Judge returned no parseable verdict (expected a JSON object with a steps array). Re-run, or try a different --model/--adapter.";
  }
  const knownStepKeys = new Set(workflow.steps.map((step) => step.key));
  return {
    workflowKey: typeof record.workflowKey === "string" ? record.workflowKey : workflow.key,
    steps: record.steps.map((entry) => coerceStepVerdict(entry, knownStepKeys)).filter((entry): entry is StepVerdict => entry !== null),
    complexityFlags: Array.isArray(record.complexityFlags)
      ? record.complexityFlags.map(coerceComplexityFlag).filter((entry): entry is ComplexityFlag => entry !== null)
      : [],
    summary: typeof record.summary === "string" ? record.summary : "",
  };
}
