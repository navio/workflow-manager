import { resolveTaskAdapter } from "./adapters.js";
import { executeStep } from "./engine.js";
import { renderCatalogForPrompt } from "./modelCatalog.js";
import type { TaskCategory } from "./modelCatalog.js";
import { validateRuntimeRequirements } from "./runtimePreflight.js";
import type { AdapterKey, InputEnvelope, OutputEnvelope, StepDefinition, WorkflowDefinition } from "./types.js";

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

export function buildJudgePrompt(digest: WorkflowDigest): string {
  return [
    "You are a workflow judge for wfm, a CLI workflow orchestrator. You are given a digest of a workflow definition (step objectives, configured adapters/models, dependencies, context-size hints — full prompt text is intentionally omitted).",
    "Judge two things:",
    "1. Model right-sizing per task step: categorize each step's task, then decide whether the configured model is ok, overkill, or underpowered for it, using the model catalog below. When a model string matches nothing in the catalog, reason from its name but use verdict \"unknown\" rather than guessing confidently. Suggest a cheaper suitable model for overkill steps and a stronger one for underpowered steps.",
    "2. Workflow complexity: flag steps that try to do too much (step-too-broad), steps that receive full global state but clearly need less (missing-state-scoping — only when stateFrom is absent), oversized context (context-bloat), redundant steps (redundant-step), and vague objectives (unclear-objective).",
    "Model catalog (cost band 1 = cheapest, 5 = priciest):",
    renderCatalogForPrompt(),
    "Respond by setting mutated_payload.judgeVerdict in your output envelope to EXACTLY one JSON object of this shape, with no other content:",
    JSON.stringify(
      {
        workflowKey: "<workflow key>",
        steps: [
          {
            stepKey: "<step key>",
            category: "coding | general | retrieval | review | orchestration | summarization",
            configuredModel: "<model string or omit>",
            verdict: "ok | overkill | underpowered | unknown",
            suggestedModel: "<model string, only for overkill/underpowered>",
            reasoning: "<one or two sentences>",
          },
        ],
        complexityFlags: [
          {
            kind: "step-too-broad | missing-state-scoping | context-bloat | redundant-step | unclear-objective | other",
            stepKeys: ["<step key>"],
            suggestion: "<one sentence>",
          },
        ],
        summary: "<two or three sentences on the workflow overall>",
      },
      null,
      2
    ),
    "Only include task steps in steps[]. Skip approval/system steps.",
    "Workflow digest:",
    JSON.stringify(digest, null, 2),
  ].join("\n\n");
}

export function buildMockVerdict(digest: WorkflowDigest): JudgeVerdict {
  return {
    workflowKey: digest.key,
    steps: digest.steps
      .filter((step) => step.kind === "task")
      .map((step) => ({
        stepKey: step.key,
        category: "general" as TaskCategory,
        configuredModel: step.model,
        verdict: "unknown" as const,
        reasoning: "Mock adapter dry-run; no LLM judgment performed.",
      })),
    complexityFlags: [],
    summary: "Mock judge run — use a real adapter (e.g. --adapter pi-agent) for actual judgment.",
  };
}

export interface JudgeOptions {
  adapterKey?: AdapterKey;
  model?: string;
}

export async function runJudge(
  workflow: WorkflowDefinition,
  workflowFilePath: string,
  options: JudgeOptions = {}
): Promise<JudgeVerdict | string> {
  const digest = buildWorkflowDigest(workflow);
  const adapterKey = options.adapterKey ?? "pi-agent";
  const payload: Record<string, unknown> = {};
  if (adapterKey === "mock") {
    payload.mockJudgeVerdict = buildMockVerdict(digest);
  }

  const judgeStep: StepDefinition = {
    key: "__judge__",
    kind: "task",
    title: "Workflow judge",
    objective: "Judge this workflow's per-step model choices and overall complexity. Output the verdict JSON as instructed.",
    taskSpec: {
      adapterKey,
      init: {
        model: options.model,
        systemPrompts: [buildJudgePrompt(digest)],
      },
      payload,
    },
  };
  const syntheticWorkflow: WorkflowDefinition = {
    key: `judge-${workflow.key}`,
    title: `Judge: ${workflow.title}`,
    steps: [judgeStep],
  };

  const runtimeErrors = validateRuntimeRequirements(syntheticWorkflow);
  if (runtimeErrors.length > 0) {
    return `Judge preflight failed:\n${runtimeErrors.map((error) => `- ${error}`).join("\n")}`;
  }

  const input: InputEnvelope = {
    global_context: {
      workflow_id: syntheticWorkflow.key,
      primary_objective: judgeStep.objective ?? "",
      workflow_objectives: [],
      global_state: {},
    },
    step_context: {
      step_id: judgeStep.key,
      step_objective: judgeStep.objective ?? "",
      previous_output: {},
      assigned_node_type: "AGENT",
    },
    priming_configuration: {
      required_skills: [],
      mcp_endpoints: [],
      system_prompts: judgeStep.taskSpec?.init?.systemPrompts ?? [],
      adapter: adapterKey,
      model: options.model,
    },
  };

  const output = await executeStep(judgeStep, input, 1, syntheticWorkflow, workflowFilePath, {
    onStderr: (chunk) => process.stderr.write(chunk),
  });
  if (output.execution_status !== "SUCCESS") {
    const reason = output.qa_routing.feedback_reason || output.execution_status;
    return `Judge execution failed: ${reason}`;
  }

  const candidate = extractVerdictCandidate(output);
  if (candidate === undefined && adapterKey !== "mock" && "mockResult" in output.mutated_payload) {
    return `Judge step was mock-routed for adapter "${adapterKey}" — no LLM judgment was performed. Configure the adapter for real execution (set taskSpec.payload.useRealAdapter/acpCommand so it runs through ACP), or pass --adapter mock for an explicit dry-run.`;
  }
  return parseJudgeVerdict(candidate, workflow);
}
