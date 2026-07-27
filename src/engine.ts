import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { executeAcpStep, shouldUseRealAcp } from "./acpExecutor.js";
import { resolveTaskAdapter, resolveValidatorAgentSpec } from "./adapters.js";
import { EventLog } from "./events.js";
import { executeClaudeCodeStep, shouldUseRealClaudeCode } from "./claudeCodeExecutor.js";
import type { ContextMetrics } from "./contextMetrics.js";
import { executeMockStep } from "./mockExecutor.js";
import { executePiAgentStep } from "./piAgentExecutor.js";
import { adapterMockFallbackReason, validateRuntimeRequirements } from "./runtimePreflight.js";
import type {
  ApprovalPreview,
  ApprovalDecisionPayload,
  ContextSummary,
  ExecutionStatus,
  InputEnvelope,
  OutputEnvelope,
  QaAction,
  RunEvent,
  RunOptions,
  RunResult,
  RunSnapshot,
  StepDefinition,
  StepDetailSnapshot,
  StepExecutionHooks,
  StepLastExecution,
  StepRun,
  ValidationMode,
  WorkflowDefinition,
  WorkflowRunStatus,
} from "./types.js";

interface StepRuntimeMeta {
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  lastExecution: StepLastExecution;
}

function nodeType(step: StepDefinition): "AGENT" | "HUMAN" | "SYSTEM" {
  if (step.kind === "approval") return "HUMAN";
  if (step.kind === "system") return "SYSTEM";
  return "AGENT";
}

function stepAdapter(step: StepDefinition): StepDetailSnapshot["adapter"] {
  return step.kind === "task" ? resolveTaskAdapter(step.taskSpec?.adapterKey) : "approval";
}

function stepObjective(step: StepDefinition, workflowObjective: string): string {
  return step.objective ?? `${workflowObjective} :: ${step.key}`;
}

function stepLabel(step: StepDefinition): string {
  return step.title ?? step.objective ?? step.key;
}

const EXECUTION_STATUSES: readonly ExecutionStatus[] = ["SUCCESS", "QA_REJECTED", "YIELD_EXTERNAL", "FAILED"];
const QA_ACTIONS: readonly QaAction[] = ["PROCEED", "RETRY_CURRENT", "ROLLBACK_PREVIOUS", "RESTART_ALL"];

function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return typeof value === "string" && EXECUTION_STATUSES.includes(value as ExecutionStatus);
}

function isQaAction(value: unknown): value is QaAction {
  return typeof value === "string" && QA_ACTIONS.includes(value as QaAction);
}

function extractContextMetrics(mutatedPayload: Record<string, unknown>): ContextMetrics | null {
  const value = mutatedPayload.contextMetrics;
  return value && typeof value === "object" ? (value as ContextMetrics) : null;
}

function validatedExecutorOutput(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  output: OutputEnvelope
): OutputEnvelope {
  if (isExecutionStatus(output.execution_status) && isQaAction(output.qa_routing.action)) {
    return output;
  }

  const invalidExecutionStatus = isExecutionStatus(output.execution_status) ? null : String(output.execution_status);
  const invalidQaAction = isQaAction(output.qa_routing.action) ? null : String(output.qa_routing.action);
  const reason = [
    invalidExecutionStatus ? `execution_status=${invalidExecutionStatus}` : null,
    invalidQaAction ? `qa_routing.action=${invalidQaAction}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    step_id: step.key,
    execution_status: "FAILED",
    qa_routing: {
      action: "PROCEED",
      feedback_reason: `Invalid executor output for ${step.key}: ${reason}`,
    },
    mutated_payload: {
      stepKey: step.key,
      attempt,
      adapter: input.priming_configuration.adapter ?? stepAdapter(step),
      invalidExecutionStatus,
      invalidQaAction,
    },
    metadata: {
      execution_time_ms: output.metadata.execution_time_ms,
      external_intervention_required: false,
    },
  };
}

function orderStepsByDependencies(steps: StepDefinition[]): StepDefinition[] {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const ordered: StepDefinition[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (step: StepDefinition): void => {
    if (visited.has(step.key)) {
      return;
    }

    if (visiting.has(step.key)) {
      throw new Error(`Circular dependency detected at step ${step.key}`);
    }

    visiting.add(step.key);
    for (const dependency of step.dependsOn ?? []) {
      const dependencyStep = byKey.get(dependency);
      if (dependencyStep) {
        visit(dependencyStep);
      }
    }
    visiting.delete(step.key);
    visited.add(step.key);
    ordered.push(step);
  };

  for (const step of steps) {
    visit(step);
  }

  return ordered;
}

function summarizeContext(value: unknown): ContextSummary {
  if (typeof value === "string") {
    return { type: "string", length: value.length };
  }

  if (value && typeof value === "object") {
    return { type: "object", keys: Object.keys(value as Record<string, unknown>).sort() };
  }

  return { type: "none" };
}

function requiresValidation(step: StepDefinition): ValidationMode {
  if (step.approvalSpec?.validation?.required) return step.approvalSpec.validation.mode ?? "human";
  if (step.validation?.required) return step.validation.mode ?? "human";
  if (step.kind === "approval") return step.approvalSpec?.validation?.mode ?? "human";
  return step.validation?.mode ?? "none";
}

export function canUseInteractiveConfirmation(step: StepDefinition): boolean {
  return requiresValidation(step) === "human";
}

function canConfirm(
  step: StepDefinition,
  options: RunOptions,
  output: OutputEnvelope
): { ok: boolean; reason?: string } {
  const mode = requiresValidation(step);
  // Agent validation is a QA gate handled by executeStep's validation pass below, not a
  // human confirmer — it must never be short-circuited by autoConfirmAll/confirmations.
  if ((mode === "none" || mode === "agent") && output.execution_status !== "YIELD_EXTERNAL") return { ok: true };

  if (options.autoConfirmAll) return { ok: true };
  const list = new Set(options.confirmations ?? []);
  const modeToken = `${step.key}:${mode}`;
  if (list.has(step.key) || list.has(modeToken)) return { ok: true };

  const autoConfirm = step.validation?.autoConfirm ?? step.approvalSpec?.validation?.autoConfirm ?? false;
  if (autoConfirm) return { ok: true };

  return { ok: false, reason: `Missing confirmation for ${step.key} (${mode})` };
}

function summarizeText(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function summarizeArtifact(value: unknown): string {
  if (typeof value === "string") {
    return summarizeText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 3).map((entry) => summarizeArtifact(entry)).filter(Boolean);
    return items.length > 0 ? items.join(", ") : "Array value";
  }

  if (!value || typeof value !== "object") {
    return "No review artifact available.";
  }

  const record = value as Record<string, unknown>;
  const preferredKeys = [
    "summary",
    "output",
    "storyMarkdown",
    "chapterMarkdown",
    "stdout",
    "stderr",
    "paragraph",
    "objective",
    "feedback_reason",
    "feedbackReason",
  ];
  for (const key of preferredKeys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return summarizeText(candidate);
    }
  }

  const primitives = Object.entries(record)
    .filter(([, candidate]) => typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean")
    .slice(0, 4)
    .map(([key, candidate]) => `${key}=${summarizeText(String(candidate), 60)}`);
  if (primitives.length > 0) {
    return primitives.join(", ");
  }

  const keys = Object.keys(record).slice(0, 5);
  return keys.length > 0 ? `Object with keys: ${keys.join(", ")}` : "No review artifact available.";
}

function buildApprovalPreview(
  step: StepDefinition,
  stepRuns: Map<string, StepRun>,
  previousOutput: Record<string, unknown>,
  currentOutput?: Record<string, unknown>
): ApprovalPreview {
  const items: ApprovalPreview["items"] = [];

  if (currentOutput && Object.keys(currentOutput).length > 0 && step.kind !== "approval") {
    items.push({
      stepKey: step.key,
      title: `Output from ${step.key}`,
      summary: summarizeArtifact(currentOutput),
      source: "current_step",
      status: stepRuns.get(step.key)?.status,
    });
  }

  for (const dependency of step.dependsOn ?? []) {
    items.push({
      stepKey: dependency,
      title: `Dependency ${dependency}`,
      summary: summarizeArtifact(previousOutput[dependency]),
      source: "dependency",
      status: stepRuns.get(dependency)?.status,
    });
  }

  if (items.length === 0) {
    items.push({
      stepKey: null,
      title: step.kind === "approval" ? "Manual approval gate" : "No review artifact",
      summary:
        step.kind === "approval"
          ? "This step is a manual checkpoint. Approving it continues the workflow."
          : "This step did not emit a review artifact. Approving it continues the workflow.",
      source: "approval_gate",
    });
  }

  const summary =
    step.kind === "approval"
      ? `Approve this gate to continue after ${items
          .filter((item) => item.stepKey)
          .map((item) => item.stepKey)
          .join(", ") || "the previous step"}.`
      : `Approve the results of ${step.key} before the workflow continues.`;

  return {
    stepLabel: stepLabel(step),
    objective: step.objective ?? step.title ?? null,
    summary,
    items,
  };
}

export async function promptForApprovalDecision(
  stepKey: string,
  reason: string,
  validation: ValidationMode,
  preview: ApprovalPreview | null,
  actor: string,
  signal?: AbortSignal
): Promise<ApprovalDecisionPayload | null> {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const decisionVerb = validation === "external" ? "Resume" : "Approve";
  const positiveAnswers = new Set(["a", "approve", "y", "yes", "r", "resume"]);
  const negativeAnswers = new Set(["c", "cancel", "n", "no"]);

  const render = () => {
    process.stderr.write(`\n${decisionVerb} required for ${stepKey}\n`);
    process.stderr.write(`- Reason: ${reason}\n`);
    process.stderr.write(`- Validation: ${validation}\n`);
    if (preview) {
      process.stderr.write(`- Step: ${preview.stepLabel}\n`);
      process.stderr.write(`- What you are deciding: ${preview.summary}\n`);
      for (const item of preview.items) {
        const status = item.status ? ` [${item.status}]` : "";
        process.stderr.write(`  - ${item.title}${status}: ${item.summary}\n`);
      }
    }
  };

  render();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ApprovalDecisionPayload | null) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      rl.close();
      process.stdin.resume();
      resolve(value);
    };
    const onAbort = () => {
      finish(null);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const ask = () => {
      rl.question(`${decisionVerb} now? [a]pprove/[r]esume / [c]ancel / [v]iew: `, (answer) => {
        if (signal?.aborted) {
          finish(null);
          return;
        }

        const normalized = answer.trim().toLowerCase();
        if (positiveAnswers.has(normalized)) {
          finish({ decision: "approved", actor, source: "terminal" });
          return;
        }

        if (negativeAnswers.has(normalized)) {
          finish({ decision: "cancelled", actor, source: "terminal", note: "cancelled in terminal" });
          return;
        }

        if (normalized === "v" || normalized === "view" || normalized === "") {
          render();
          ask();
          return;
        }

        process.stderr.write("Enter 'a'/'r' to continue, 'c' to cancel, or 'v' to reprint the decision details.\n");
        ask();
      });
    };

    if (signal?.aborted) {
      finish(null);
      return;
    }

    ask();
  });
}

async function executeStep(
  step: StepDefinition,
  input: InputEnvelope,
  attempt: number,
  workflow: WorkflowDefinition,
  workflowFilePath: string,
  hooks?: StepExecutionHooks
): Promise<OutputEnvelope> {
  if (step.kind !== "task") {
    return executeMockStep(step, input, attempt, hooks);
  }

  const adapterKey = resolveTaskAdapter(step.taskSpec?.adapterKey);

  if (adapterKey === "pi-agent") {
    return executePiAgentStep(step, input, attempt, workflow, workflowFilePath, hooks);
  }

  // Legacy escape hatch: the bespoke claude-code subprocess executor is deprecated
  // in favor of ACP, but stays reachable via payload.legacyExecutor so existing
  // real-integration users are not stranded.
  const legacyExecutor = (step.taskSpec?.payload as Record<string, unknown> | undefined)?.legacyExecutor === true;
  if (legacyExecutor && adapterKey === "claude-code" && shouldUseRealClaudeCode(step)) {
    return executeClaudeCodeStep(step, input, attempt, workflow, workflowFilePath, hooks);
  }

  // All non-pi agents run through ACP. opencode runs real by default (opt out with
  // payload.useRealAdapter: false); acp / claude-code / codex opt in with
  // payload.useRealAdapter: true.
  const acpRoutable =
    adapterKey === "acp" || adapterKey === "claude-code" || adapterKey === "opencode" || adapterKey === "codex";
  if (acpRoutable && shouldUseRealAcp(step)) {
    return executeAcpStep(step, input, attempt, workflow, workflowFilePath, hooks);
  }

  const fallbackReason = adapterMockFallbackReason(step);
  if (fallbackReason) {
    hooks?.onStderr?.(`[wfm] ${step.key}: ${fallbackReason}\n`);
  }

  return executeMockStep(step, input, attempt, hooks);
}

export async function runWorkflow(definition: WorkflowDefinition, options?: RunOptions): Promise<RunResult> {
  const runId = options?.runId ?? randomUUID();
  const actor = options?.actor ?? "cli";
  const primaryObjective = options?.objective ?? definition.title;
  const workflowObjectives = definition.objectives ?? [];
  const globalState: Record<string, unknown> = { ...(options?.input ?? {}) };
  const workflowFilePath = options?.workflowFilePath ?? "";
  const eventLog = new EventLog();
  const observer = options?.observer;
  const controller = options?.controller;

  let runStatus: WorkflowRunStatus = "queued";
  let currentStepKey: string | null = null;
  let runStartedAt: string | null = null;
  let runUpdatedAt = new Date().toISOString();
  let runEndedAt: string | null = null;
  let waitingForApproval: RunSnapshot["waitingForApproval"] = null;

  const stepRuns = new Map<string, StepRun>();
  const stepRuntime = new Map<string, StepRuntimeMeta>();

  const emptyExecution = (): StepLastExecution => ({
    executionStatus: null,
    qaAction: null,
    feedbackReason: null,
    contextMetrics: null,
  });

  const touchRun = (ended = false): void => {
    const now = new Date().toISOString();
    runUpdatedAt = now;
    if (ended) {
      runEndedAt = now;
    }
  };

  const touchStep = (
    stepKey: string,
    patch: Partial<Omit<StepRuntimeMeta, "lastExecution">> & { lastExecution?: StepLastExecution }
  ): void => {
    const current = stepRuntime.get(stepKey);
    if (!current) {
      return;
    }

    const now = new Date().toISOString();
    if (patch.startedAt !== undefined) current.startedAt = patch.startedAt;
    if (patch.finishedAt !== undefined) current.finishedAt = patch.finishedAt;
    if (patch.lastExecution) current.lastExecution = { ...patch.lastExecution };
    current.updatedAt = patch.updatedAt ?? now;
    touchRun(false);
  };

  const buildStepDetails = (): StepDetailSnapshot[] =>
    definition.steps.map((step) => {
      const run = stepRuns.get(step.key)!;
      const runtime = stepRuntime.get(step.key)!;
      return {
        stepKey: step.key,
        status: run.status,
        attempt: run.attempt,
        confirmed: run.confirmed,
        adapter: stepAdapter(step),
        startedAt: runtime.startedAt,
        updatedAt: runtime.updatedAt,
        finishedAt: runtime.finishedAt,
        kind: step.kind,
        objective: step.objective ?? step.title ?? null,
        dependsOn: step.dependsOn ?? [],
        config: {
          model: typeof step.taskSpec?.init?.model === "string" ? step.taskSpec.init.model : null,
          skills: step.taskSpec?.init?.skills ?? [],
          mcps: step.taskSpec?.init?.mcps ?? [],
          systemPrompts: step.taskSpec?.init?.systemPrompts ?? [],
          contextSummary: summarizeContext(step.taskSpec?.init?.context),
        },
        lastExecution: { ...runtime.lastExecution },
      };
    });

  const buildSnapshot = (): RunSnapshot => ({
    runId,
    workflowKey: definition.key,
    workflowTitle: definition.title,
    status: runStatus,
    currentStepKey,
    startedAt: runStartedAt,
    updatedAt: runUpdatedAt,
    endedAt: runEndedAt,
    objective: primaryObjective,
    objectives: [...workflowObjectives],
    waitingForApproval: waitingForApproval ? { ...waitingForApproval } : null,
    steps: definition.steps.map((step) => {
      const run = stepRuns.get(step.key)!;
      const runtime = stepRuntime.get(step.key)!;
      return {
        stepKey: step.key,
        status: run.status,
        attempt: run.attempt,
        confirmed: run.confirmed,
        adapter: stepAdapter(step),
        startedAt: runtime.startedAt,
        updatedAt: runtime.updatedAt,
        finishedAt: runtime.finishedAt,
      };
    }),
  });

  const emitSnapshot = (): void => {
    observer?.onSnapshot(buildSnapshot(), buildStepDetails());
  };

  const pushEvent = (
    type: RunEvent["type"],
    payload: Record<string, unknown> = {},
    stepKey?: string,
    eventActor = "system"
  ): void => {
    const event = eventLog.push(runId, type, payload, stepKey, eventActor);
    observer?.onEvent(event);
  };

  const emitLog = (stepKey: string, stream: "stdout" | "stderr", text: string): void => {
    observer?.onLog({
      id: randomUUID(),
      runId,
      stepKey,
      stream,
      text,
      occurredAt: new Date().toISOString(),
    });
  };

  const waitForDecision = async (
    step: StepDefinition,
    stepRun: StepRun,
    reason: string,
    validation: ValidationMode,
    requireConfirmationEvent: boolean,
    preview: ApprovalPreview | null = null
  ): Promise<ApprovalDecisionPayload | null> => {
    stepRun.status = "waiting_for_approval";
    runStatus = "waiting_for_approval";
    waitingForApproval = {
      stepKey: step.key,
      reason,
      validation,
      preview,
    };
    touchStep(step.key, { finishedAt: null });
    pushEvent("step.waiting_for_approval", { reason, validation, preview }, step.key);
    pushEvent("run.waiting_for_approval", { reason, preview }, step.key, actor);
    emitSnapshot();

    const request = { stepKey: step.key, reason, validation };
    let resolution: ApprovalDecisionPayload | null = null;

    if (controller) {
      const promptAbort = new AbortController();
      const promptTask = options?.approvalPrompt
        ? options.approvalPrompt({ ...request, preview, signal: promptAbort.signal }).catch((error) => {
            if (promptAbort.signal.aborted) {
              return null;
            }
            throw error;
          })
        : null;

      try {
        resolution = await controller.waitForDecision(request);
      } finally {
        promptAbort.abort();
        await promptTask;
      }
    } else if (options?.approvalPrompt) {
      resolution = await options.approvalPrompt({ ...request, preview });
    } else if (options?.interactive && process.stdin.isTTY) {
      resolution = await promptForApprovalDecision(step.key, reason, validation, preview, actor);
    }

    if (!resolution) {
      return null;
    }

    const resolutionActor = resolution.actor?.trim() ? resolution.actor : actor;
    pushEvent(
      "approval.resolved",
      {
        decision: resolution.decision,
        actor: resolutionActor,
        note: resolution.note ?? null,
        source: resolution.source ?? "api",
      },
      step.key,
      resolutionActor
    );

    if (resolution.decision === "cancelled") {
      stepRun.status = "cancelled";
      runStatus = "cancelled";
      currentStepKey = step.key;
      waitingForApproval = null;
      touchStep(step.key, { finishedAt: new Date().toISOString() });
      touchRun(true);
      pushEvent(
        "run.cancelled",
        { stepKey: step.key, reason: resolution.note ?? "cancelled by API", source: resolution.source ?? "api" },
        step.key,
        resolutionActor
      );
      emitSnapshot();
      return resolution;
    }

    waitingForApproval = null;
    runStatus = "running";
    if (requireConfirmationEvent) {
      stepRun.confirmed = true;
      pushEvent(
        "step.confirmed",
        { by: resolutionActor, validation, note: resolution.note ?? null, source: resolution.source ?? "api" },
        step.key,
        resolutionActor
      );
    }
    emitSnapshot();
    return resolution;
  };

  type QaRejectionOutcome = { stop: true } | { stop?: false; index: number };

  // Applies a QA rejection's routing action (RETRY_CURRENT / ROLLBACK_PREVIOUS / RESTART_ALL /
  // unknown) to `step`, mutating run/step state exactly the way a step's own self-reported
  // QA_REJECTED output would. Shared by the direct QA_REJECTED path and by agent validation,
  // which routes its verdict through the same machinery.
  const applyQaRejection = (
    step: StepDefinition,
    stepRun: StepRun,
    index: number,
    qaAction: string,
    feedbackReason: string
  ): QaRejectionOutcome => {
    const retryMax = step.retryPolicy?.maxAttempts ?? definition.defaultRetryPolicy?.maxAttempts ?? 1;

    if (qaAction === "RETRY_CURRENT") {
      if (stepRun.attempt < retryMax) {
        stepRun.status = "pending";
        touchStep(step.key, { finishedAt: new Date().toISOString() });
        pushEvent("step.retried", { stepKey: step.key, attempt: stepRun.attempt + 1 }, step.key);
        emitSnapshot();
        return { index };
      }
      stepRun.status = "failed";
      runStatus = "failed";
      currentStepKey = step.key;
      touchStep(step.key, { finishedAt: new Date().toISOString() });
      touchRun(true);
      pushEvent(
        "run.failed",
        { stepKey: step.key, reason: feedbackReason ? `max retry exceeded: ${feedbackReason}` : "max retry exceeded" },
        step.key
      );
      emitSnapshot();
      return { stop: true };
    }

    if (qaAction === "ROLLBACK_PREVIOUS") {
      if (index === 0) {
        stepRun.status = "failed";
        runStatus = "failed";
        currentStepKey = step.key;
        touchStep(step.key, { finishedAt: new Date().toISOString() });
        touchRun(true);
        pushEvent(
          "run.failed",
          {
            stepKey: step.key,
            reason: feedbackReason
              ? `cannot rollback before first step: ${feedbackReason}`
              : "cannot rollback before first step",
          },
          step.key
        );
        emitSnapshot();
        return { stop: true };
      }

      const prevStep = orderedSteps[index - 1];
      const prevRun = stepRuns.get(prevStep.key)!;
      prevRun.status = "pending";
      prevRun.attempt = 0;
      prevRun.confirmed = false;
      delete prevRun.output;
      delete globalState[prevStep.key];
      delete stepRun.output;
      delete globalState[step.key];
      touchStep(prevStep.key, { startedAt: null, finishedAt: null, lastExecution: emptyExecution() });
      pushEvent("step.retried", { stepKey: prevStep.key, via: step.key }, prevStep.key);
      stepRun.status = "pending";
      stepRun.confirmed = false;
      touchStep(step.key, { finishedAt: new Date().toISOString() });
      emitSnapshot();
      return { index: index - 1 };
    }

    if (qaAction === "RESTART_ALL") {
      for (const s of definition.steps) {
        const sr = stepRuns.get(s.key)!;
        sr.status = "pending";
        sr.attempt = 0;
        sr.confirmed = false;
        delete sr.output;
        delete globalState[s.key];
        touchStep(s.key, { startedAt: null, finishedAt: null, lastExecution: emptyExecution() });
      }
      currentStepKey = null;
      pushEvent("step.retried", { mode: "restart_all", triggeredBy: step.key }, step.key);
      emitSnapshot();
      return { index: 0 };
    }

    stepRun.status = "failed";
    runStatus = "failed";
    currentStepKey = step.key;
    touchStep(step.key, { finishedAt: new Date().toISOString() });
    touchRun(true);
    pushEvent("run.failed", { stepKey: step.key, reason: `Unknown QA action: ${qaAction}` }, step.key);
    emitSnapshot();
    return { stop: true };
  };

  type AgentValidationOutcome = { type: "proceed" } | { type: "stop" } | { type: "reindex"; index: number };

  // Runs the step's configured validator agent against its just-produced output and folds the
  // verdict back into the SAME routing machinery a self-reported QA_REJECTED would use. Runs
  // unconditionally for validation.mode "agent" — autoConfirmAll/confirmations never skip it,
  // since it is a QA gate, not a human approval.
  const runAgentValidation = async (
    step: StepDefinition,
    stepRun: StepRun,
    index: number,
    input: InputEnvelope,
    executionOutput: OutputEnvelope
  ): Promise<AgentValidationOutcome> => {
    const agentSpec = step.validation?.agent ?? {};
    const resolvedValidator = resolveValidatorAgentSpec(step) ?? {
      adapterKey: agentSpec.adapterKey ?? resolveTaskAdapter(step.taskSpec?.adapterKey),
      payload: agentSpec.payload ?? {},
    };
    const validatorAdapter = resolvedValidator.adapterKey;
    const criteria = agentSpec.criteria;
    const objective = criteria
      ? `Validate the output of step "${step.key}": ${criteria}`
      : `Validate the output of step "${step.key}"`;

    const validatorStep: StepDefinition = {
      key: step.key,
      kind: "task",
      title: step.title,
      objective,
      dependsOn: step.dependsOn,
      taskSpec: {
        adapterKey: validatorAdapter,
        init: agentSpec.init,
        payload: resolvedValidator.payload,
      },
    };

    const validatorInput: InputEnvelope = {
      global_context: input.global_context,
      step_context: {
        step_id: step.key,
        step_objective: objective,
        previous_output: { [step.key]: executionOutput.mutated_payload },
        assigned_node_type: "AGENT",
      },
      priming_configuration: {
        required_skills: agentSpec.init?.skills ?? [],
        mcp_endpoints: agentSpec.init?.mcps ?? [],
        system_prompts: agentSpec.init?.systemPrompts ?? [],
        context: agentSpec.init?.context,
        adapter: validatorAdapter,
        model: agentSpec.init?.model,
      },
    };

    pushEvent("step.validation_started", { adapter: validatorAdapter, criteria: criteria ?? null }, step.key);
    emitSnapshot();

    const validationHooks: StepExecutionHooks = {
      onStarted: (payload) => {
        pushEvent("agent.started", { attempt: stepRun.attempt, validator: true, ...(payload ?? {}) }, step.key);
      },
      onStdout: (chunk) => {
        emitLog(step.key, "stdout", chunk);
        pushEvent("agent.stdout", { stream: "stdout", text: chunk }, step.key);
      },
      onStderr: (chunk) => {
        emitLog(step.key, "stderr", chunk);
        pushEvent("agent.stderr", { stream: "stderr", text: chunk }, step.key);
      },
      onFinished: (payload) => {
        pushEvent("agent.finished", { attempt: stepRun.attempt, validator: true, ...(payload ?? {}) }, step.key);
      },
    };

    const validatorOutput = validatedExecutorOutput(
      validatorStep,
      validatorInput,
      stepRun.attempt,
      await executeStep(validatorStep, validatorInput, stepRun.attempt, definition, workflowFilePath, validationHooks)
    );

    pushEvent(
      "step.validation_finished",
      {
        status: validatorOutput.execution_status,
        action: validatorOutput.qa_routing.action,
        feedbackReason: validatorOutput.qa_routing.feedback_reason,
      },
      step.key
    );
    emitSnapshot();

    if (validatorOutput.execution_status === "SUCCESS" && validatorOutput.qa_routing.action === "PROCEED") {
      return { type: "proceed" };
    }

    if (validatorOutput.execution_status === "FAILED" || validatorOutput.execution_status === "YIELD_EXTERNAL") {
      const reason = `agent validation failed: ${
        validatorOutput.qa_routing.feedback_reason || validatorOutput.execution_status
      }`;
      stepRun.status = "failed";
      runStatus = "failed";
      currentStepKey = step.key;
      touchStep(step.key, {
        finishedAt: new Date().toISOString(),
        lastExecution: {
          executionStatus: "FAILED",
          qaAction: "PROCEED",
          feedbackReason: reason,
          contextMetrics: stepRuntime.get(step.key)?.lastExecution.contextMetrics ?? null,
        },
      });
      touchRun(true);
      pushEvent("run.failed", { stepKey: step.key, reason }, step.key);
      emitSnapshot();
      return { type: "stop" };
    }

    // QA_REJECTED (any action), or SUCCESS with a non-PROCEED action: route the validator's
    // verdict onto the validated step exactly like a self-reported QA rejection.
    const qaAction = String(validatorOutput.qa_routing.action);
    const feedbackReason =
      validatorOutput.qa_routing.feedback_reason || `agent validation rejected step ${step.key}`;
    touchStep(step.key, {
      lastExecution: {
        executionStatus: "QA_REJECTED",
        qaAction: isQaAction(qaAction) ? qaAction : "PROCEED",
        feedbackReason,
        contextMetrics: stepRuntime.get(step.key)?.lastExecution.contextMetrics ?? null,
      },
    });

    const outcome = applyQaRejection(step, stepRun, index, qaAction, feedbackReason);
    if ("stop" in outcome && outcome.stop) {
      return { type: "stop" };
    }
    return { type: "reindex", index: (outcome as { index: number }).index };
  };

  for (const step of definition.steps) {
    stepRuns.set(step.key, {
      stepKey: step.key,
      status: "pending",
      attempt: 0,
      confirmed: false,
    });
    stepRuntime.set(step.key, {
      startedAt: null,
      updatedAt: runUpdatedAt,
      finishedAt: null,
      lastExecution: emptyExecution(),
    });
  }

  emitSnapshot();
  pushEvent("run.created", { workflowKey: definition.key }, undefined, actor);

  const runtimeErrors = validateRuntimeRequirements(definition);
  if (runtimeErrors.length > 0) {
    runStatus = "failed";
    touchRun(true);
    pushEvent("run.failed", { reason: runtimeErrors.join("; "), runtimeErrors }, undefined, actor);
    emitSnapshot();
    return {
      runId,
      status: runStatus,
      outputs: globalState,
      stepRuns: definition.steps.map((step) => stepRuns.get(step.key)!),
      events: eventLog.all(),
    };
  }

  let orderedSteps: StepDefinition[];
  try {
    orderedSteps = orderStepsByDependencies(definition.steps);
  } catch (err) {
    runStatus = "failed";
    touchRun(true);
    pushEvent("run.failed", { reason: (err as Error).message }, undefined, actor);
    emitSnapshot();
    return {
      runId,
      status: runStatus,
      outputs: globalState,
      stepRuns: definition.steps.map((step) => stepRuns.get(step.key)!),
      events: eventLog.all(),
    };
  }

  runStatus = "running";
  runStartedAt = new Date().toISOString();
  touchRun(false);
  pushEvent("run.started", { objective: primaryObjective, objectives: workflowObjectives }, undefined, actor);
  emitSnapshot();

  let index = 0;
  let guard = 0;
  const maxSteps = Math.max(definition.steps.length * 30, 30);

  while (index < orderedSteps.length) {
    guard += 1;
    if (guard > maxSteps) {
      runStatus = "failed";
      touchRun(true);
      pushEvent("run.failed", { reason: "Execution guard exceeded" });
      emitSnapshot();
      break;
    }

    const step = orderedSteps[index];
    const stepRun = stepRuns.get(step.key);
    if (!stepRun) throw new Error(`Missing step run for ${step.key}`);

    const dependencies = step.dependsOn ?? [];
    const depsComplete = dependencies.every((depKey) => stepRuns.get(depKey)?.status === "succeeded");
    if (!depsComplete) {
      runStatus = "failed";
      currentStepKey = step.key;
      touchRun(true);
      pushEvent("run.failed", { reason: `Dependencies not satisfied for ${step.key}` }, step.key);
      emitSnapshot();
      break;
    }

    stepRun.status = "runnable";
    currentStepKey = step.key;
    waitingForApproval = null;
    touchStep(step.key, { finishedAt: null });
    pushEvent("step.runnable", { stepKey: step.key }, step.key);
    emitSnapshot();

    stepRun.status = "running";
    stepRun.attempt += 1;
    delete stepRun.output;
    delete globalState[step.key];
    touchStep(step.key, { startedAt: new Date().toISOString(), finishedAt: null });
    pushEvent("step.claimed", { attempt: stepRun.attempt }, step.key);
    pushEvent("step.execution_started", { attempt: stepRun.attempt }, step.key);
    emitSnapshot();

    const previousOutput: Record<string, unknown> = {};
    for (const dep of dependencies) {
      previousOutput[dep] = stepRuns.get(dep)?.output ?? null;
    }

    const inputEnvelope: InputEnvelope = {
      global_context: {
        workflow_id: runId,
        primary_objective: primaryObjective,
        workflow_objectives: workflowObjectives,
        global_state: globalState,
      },
      step_context: {
        step_id: step.key,
        step_objective: stepObjective(step, primaryObjective),
        previous_output: previousOutput,
        assigned_node_type: nodeType(step),
      },
      priming_configuration: {
        required_skills: step.taskSpec?.init?.skills ?? [],
        mcp_endpoints: step.taskSpec?.init?.mcps ?? [],
        system_prompts: step.taskSpec?.init?.systemPrompts ?? [],
        context: step.taskSpec?.init?.context,
        adapter: resolveTaskAdapter(step.taskSpec?.adapterKey),
        model: step.taskSpec?.init?.model,
      },
    };

    const hooks: StepExecutionHooks = {
      onStarted: (payload) => {
        pushEvent("agent.started", { attempt: stepRun.attempt, ...(payload ?? {}) }, step.key);
      },
      onStdout: (chunk) => {
        emitLog(step.key, "stdout", chunk);
        pushEvent("agent.stdout", { stream: "stdout", text: chunk }, step.key);
      },
      onStderr: (chunk) => {
        emitLog(step.key, "stderr", chunk);
        pushEvent("agent.stderr", { stream: "stderr", text: chunk }, step.key);
      },
      onFinished: (payload) => {
        pushEvent("agent.finished", { attempt: stepRun.attempt, ...(payload ?? {}) }, step.key);
      },
    };

    const output = validatedExecutorOutput(
      step,
      inputEnvelope,
      stepRun.attempt,
      await executeStep(step, inputEnvelope, stepRun.attempt, definition, workflowFilePath, hooks)
    );
    const contextMetrics = extractContextMetrics(output.mutated_payload);
    touchStep(step.key, {
      lastExecution: {
        executionStatus: output.execution_status,
        qaAction: output.qa_routing.action,
        feedbackReason: output.qa_routing.feedback_reason,
        contextMetrics,
      },
    });
    pushEvent(
      "step.execution_finished",
      {
        status: output.execution_status,
        action: output.qa_routing.action,
        feedbackReason: output.qa_routing.feedback_reason,
        adapter: resolveTaskAdapter(step.taskSpec?.adapterKey),
        contextMetrics,
        init: {
          skills: step.taskSpec?.init?.skills ?? [],
          mcps: step.taskSpec?.init?.mcps ?? [],
          context: step.taskSpec?.init?.context ?? {},
          systemPrompts: step.taskSpec?.init?.systemPrompts ?? [],
          model: step.taskSpec?.init?.model ?? null,
        },
      },
      step.key
    );
    emitSnapshot();

    const approvalPreview = buildApprovalPreview(step, stepRuns, previousOutput, output.mutated_payload);
    const confirmed = canConfirm(step, options ?? {}, output).ok;
    if (!confirmed) {
      const validation = requiresValidation(step);
      const decision = await waitForDecision(
        step,
        stepRun,
        `confirmation required for ${step.key}`,
        validation,
        true,
        approvalPreview
      );
      if (decision === null || decision.decision === "cancelled") {
        break;
      }
    }

    if (!stepRun.confirmed) {
      stepRun.confirmed = true;
      waitingForApproval = null;
      pushEvent("step.confirmed", { by: actor, validation: requiresValidation(step) }, step.key, actor);
      emitSnapshot();
    }

    if (output.execution_status === "YIELD_EXTERNAL") {
      if (step.kind === "approval") {
        stepRun.status = "succeeded";
        runStatus = "running";
        waitingForApproval = null;
        stepRun.output = output.mutated_payload;
        globalState[step.key] = output.mutated_payload;
        touchStep(step.key, { finishedAt: new Date().toISOString() });
        currentStepKey = null;
        emitSnapshot();
        index += 1;
        continue;
      }

      const decision = await waitForDecision(
        step,
        stepRun,
        "external intervention",
        "external",
        false,
        approvalPreview
      );
      if (decision === null || decision.decision === "cancelled") {
        break;
      }
      stepRun.status = "succeeded";
      runStatus = "running";
      waitingForApproval = null;
      stepRun.output = output.mutated_payload;
      globalState[step.key] = output.mutated_payload;
      touchStep(step.key, { finishedAt: new Date().toISOString() });
      currentStepKey = null;
      emitSnapshot();
      index += 1;
      continue;
    }

    if (output.execution_status === "FAILED") {
      stepRun.status = "failed";
      runStatus = "failed";
      currentStepKey = step.key;
      touchStep(step.key, { finishedAt: new Date().toISOString() });
      touchRun(true);
      pushEvent("run.failed", { stepKey: step.key, reason: "step failed" }, step.key);
      emitSnapshot();
      break;
    }

    if (output.execution_status === "QA_REJECTED") {
      const outcome = applyQaRejection(step, stepRun, index, String(output.qa_routing.action), output.qa_routing.feedback_reason);
      if ("stop" in outcome && outcome.stop) {
        break;
      }
      index = (outcome as { index: number }).index;
      continue;
    }

    if (
      step.kind === "task" &&
      output.execution_status === "SUCCESS" &&
      output.qa_routing.action === "PROCEED" &&
      requiresValidation(step) === "agent"
    ) {
      const validationOutcome = await runAgentValidation(step, stepRun, index, inputEnvelope, output);
      if (validationOutcome.type === "stop") {
        break;
      }
      if (validationOutcome.type === "reindex") {
        index = validationOutcome.index;
        continue;
      }
      // "proceed": validator approved — fall through to the normal success path below.
    }

    stepRun.status = "succeeded";
    stepRun.output = output.mutated_payload;
    globalState[step.key] = output.mutated_payload;
    touchStep(step.key, { finishedAt: new Date().toISOString() });
    currentStepKey = null;
    emitSnapshot();
    index += 1;
  }

  if (runStatus === "running") {
    runStatus = "succeeded";
    currentStepKey = null;
    touchRun(true);
    pushEvent("run.completed", { steps: definition.steps.length }, undefined, actor);
    emitSnapshot();
  }

  return {
    runId,
    status: runStatus,
    outputs: globalState,
    stepRuns: definition.steps.map((step) => stepRuns.get(step.key)!),
    events: eventLog.all(),
  };
}
