import type { AdapterKey, ExecutionStatus, QaAction, StepAttemptRecord, StepKind, StepRun, WorkflowDefinition } from "../types.js";

export const TELEMETRY_SCHEMA_VERSION = 2 as const;

export const MAX_TELEMETRY_STRING_LENGTH = 300;
export const MAX_TELEMETRY_STEPS = 500;

export type WorkflowOrigin = "remote" | "local";
export type RunnerPlatform = "darwin" | "linux" | "win32" | "unknown";
export type TelemetryTerminalState = "succeeded" | "failed" | "waiting_for_approval" | "cancelled";

export type FailureCategory = "validation" | "preflight" | "adapter" | "execution" | "approval" | "cancelled" | "unknown";

const FAILURE_CATEGORIES: readonly FailureCategory[] = [
  "validation",
  "preflight",
  "adapter",
  "execution",
  "approval",
  "cancelled",
  "unknown",
];

const RUNNER_PLATFORMS: readonly RunnerPlatform[] = ["darwin", "linux", "win32", "unknown"];

const TERMINAL_STATES: readonly TelemetryTerminalState[] = ["succeeded", "failed", "waiting_for_approval", "cancelled"];

const EXECUTION_STATUSES: readonly ExecutionStatus[] = ["SUCCESS", "QA_REJECTED", "YIELD_EXTERNAL", "FAILED"];
const QA_ACTIONS: readonly QaAction[] = ["PROCEED", "RETRY_CURRENT", "ROLLBACK_PREVIOUS", "RESTART_ALL"];

export interface StepTelemetryPayload {
  stepKey: string;
  stepKind: StepKind;
  attempt: number;
  terminalStatus: TelemetryTerminalState;
  adapter: AdapterKey | "approval" | "system";
  requestedModel: string | null;
  startedAt: string | null;
  endedAt: string | null;
  executionDurationMs: number | null;
  queueDurationMs: number | null;
  executionStatus: ExecutionStatus | null;
  qaAction: QaAction | null;
}

export interface RunTelemetryPayloadV2 {
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  runId: string;
  workflowKey: string;
  workflowTitle: string | null;
  workflowFingerprint: string;
  workflowNamespaceId: string | null;
  workflowVersionId: string | null;
  workflowVersionLabel: string | null;
  workflowOrigin: WorkflowOrigin;
  terminalState: TelemetryTerminalState;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  totalSteps: number;
  succeededSteps: number;
  failedSteps: number;
  waitingSteps: number;
  cancelledSteps: number;
  retriedSteps: number;
  eventCount: number;
  effectivenessScore: number;
  outputKeys: string[];
  cliVersion: string | null;
  runnerPlatform: RunnerPlatform;
  failureCategory: FailureCategory | null;
  failureReason: string | null;
  steps: StepTelemetryPayload[];
}

function isTerminalStepStatus(status: StepRun["status"]): status is TelemetryTerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(status);
}

// Maps a single attempt's raw execution outcome to the telemetry terminal-state vocabulary.
// Only the step's *final* attempt uses the StepRun's own terminal status (which reflects
// approval/cancellation outcomes the engine layered on top of the raw execution result);
// every earlier (retried/rejected) attempt is summarized purely from what that attempt's
// executor returned.
function attemptTerminalStatus(executionStatus: ExecutionStatus | null): TelemetryTerminalState {
  switch (executionStatus) {
    case "SUCCESS":
      return "succeeded";
    case "YIELD_EXTERNAL":
      return "waiting_for_approval";
    default:
      return "failed";
  }
}

/**
 * Projects engine step-run state into the privacy-safe telemetry shape. Steps that
 * never started (attempt 0 / still pending) are omitted entirely rather than reported
 * as zero-duration executions. Approval/system steps never carry an adapter or model,
 * even if runtime state was mistakenly populated with one, since only "task" steps run
 * on an adapter.
 *
 * Emits one record per *attempt*, not just the step's final attempt: a retried step's
 * earlier rejected/failed attempts still consumed real execution time and are part of
 * its retry cost, so they must reach telemetry rather than being silently summarized
 * away by the final attempt's success.
 */
export function buildStepTelemetryPayloads(definition: WorkflowDefinition, stepRuns: StepRun[]): StepTelemetryPayload[] {
  const stepsByKey = new Map(definition.steps.map((step) => [step.key, step]));
  const payloads: StepTelemetryPayload[] = [];

  for (const run of stepRuns) {
    if (run.attempt < 1 || !isTerminalStepStatus(run.status)) {
      continue;
    }

    const step = stepsByKey.get(run.stepKey);
    const stepKind: StepKind = step?.kind ?? "task";
    const isTask = stepKind === "task";
    const adapter = isTask ? ((run.adapter as AdapterKey | undefined) ?? "mock") : stepKind === "approval" ? "approval" : "system";
    const requestedModel = isTask ? (run.requestedModel ?? null) : null;

    // Callers/fixtures that only populate the summary fields (no attempts history) still
    // get a single synthesized attempt record rather than being dropped entirely.
    const attempts: StepAttemptRecord[] =
      run.attempts && run.attempts.length > 0
        ? run.attempts
        : [
            {
              attempt: run.attempt,
              startedAt: run.startedAt ?? null,
              endedAt: run.endedAt ?? null,
              executionDurationMs: run.executionDurationMs ?? null,
              executionStatus: null,
              qaAction: null,
            },
          ];

    for (const attemptRecord of attempts) {
      const isFinalAttempt = attemptRecord.attempt === run.attempt;
      payloads.push({
        stepKey: run.stepKey,
        stepKind,
        attempt: attemptRecord.attempt,
        terminalStatus: isFinalAttempt ? run.status : attemptTerminalStatus(attemptRecord.executionStatus),
        adapter,
        requestedModel,
        startedAt: attemptRecord.startedAt,
        endedAt: attemptRecord.endedAt,
        executionDurationMs: attemptRecord.executionDurationMs,
        queueDurationMs: null,
        executionStatus: attemptRecord.executionStatus,
        qaAction: attemptRecord.qaAction,
      });
    }
  }

  return payloads;
}

function capString(value: string | null | undefined, max = MAX_TELEMETRY_STRING_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Maps a run's terminal state and a best-effort reason string to a bounded, stable
 * failure category. Never echoes raw error objects/stacks — only a capped string.
 */
export function classifyFailure(
  reasonOrError: string | Error | null | undefined,
  terminalState: TelemetryTerminalState
): { category: FailureCategory | null; reason: string | null } {
  const rawMessage = reasonOrError instanceof Error ? reasonOrError.message : (reasonOrError ?? null);
  const reason = capString(rawMessage);

  if (terminalState === "succeeded") {
    return { category: null, reason: null };
  }

  if (terminalState === "cancelled") {
    return { category: "cancelled", reason };
  }

  if (terminalState === "waiting_for_approval") {
    return { category: "approval", reason };
  }

  const lower = (rawMessage ?? "").toLowerCase();
  if (!lower) {
    return { category: "unknown", reason };
  }

  if (lower.includes("invalid workflow") || lower.includes("validation")) {
    return { category: "validation", reason };
  }

  if (lower.includes("preflight") || lower.includes("not authenticated") || (lower.includes("missing") && lower.includes("binary"))) {
    return { category: "preflight", reason };
  }

  if (lower.includes("adapter") || lower.includes("agent") || lower.includes("mcp")) {
    return { category: "adapter", reason };
  }

  if (
    lower.includes("dependenc") ||
    lower.includes("execution guard") ||
    lower.includes("step failed") ||
    lower.includes("max retry") ||
    lower.includes("rollback")
  ) {
    return { category: "execution", reason };
  }

  return { category: "unknown", reason };
}

function allowedTerminalState(value: unknown): TelemetryTerminalState {
  return (TERMINAL_STATES as readonly unknown[]).includes(value) ? (value as TelemetryTerminalState) : "failed";
}

function allowedRunnerPlatform(value: unknown): RunnerPlatform {
  return (RUNNER_PLATFORMS as readonly unknown[]).includes(value) ? (value as RunnerPlatform) : "unknown";
}

function allowedFailureCategory(value: unknown): FailureCategory | null {
  return (FAILURE_CATEGORIES as readonly unknown[]).includes(value) ? (value as FailureCategory) : null;
}

function allowedExecutionStatus(value: unknown): ExecutionStatus | null {
  return (EXECUTION_STATUSES as readonly unknown[]).includes(value) ? (value as ExecutionStatus) : null;
}

function allowedQaAction(value: unknown): QaAction | null {
  return (QA_ACTIONS as readonly unknown[]).includes(value) ? (value as QaAction) : null;
}

function nonNegativeInt(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
}

function nonNegativeIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : null;
}

function scoreInRange(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num * 100) / 100));
}

function isUuidLike(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function serializeStepTelemetry(step: StepTelemetryPayload): StepTelemetryPayload {
  const stepKind: StepKind = step.stepKind === "approval" || step.stepKind === "system" ? step.stepKind : "task";
  const isTask = stepKind === "task";
  return {
    stepKey: capString(step.stepKey, 200) ?? "",
    stepKind,
    attempt: nonNegativeInt(step.attempt),
    terminalStatus: allowedTerminalState(step.terminalStatus),
    adapter: isTask ? (capString(step.adapter, 40) ?? "mock") as AdapterKey : stepKind === "approval" ? "approval" : "system",
    requestedModel: isTask ? capString(step.requestedModel, 100) : null,
    startedAt: typeof step.startedAt === "string" ? step.startedAt : null,
    endedAt: typeof step.endedAt === "string" ? step.endedAt : null,
    executionDurationMs: nonNegativeIntOrNull(step.executionDurationMs),
    queueDurationMs: nonNegativeIntOrNull(step.queueDurationMs),
    executionStatus: allowedExecutionStatus(step.executionStatus),
    qaAction: allowedQaAction(step.qaAction),
  };
}

/**
 * The sole boundary between engine-derived telemetry and what leaves the process.
 * Reconstructs the payload field-by-field from an explicit allow-list rather than
 * blacklisting dangerous keys, so any extra/unexpected property on the input
 * (raw input, output, prompts, hostnames, paths, tokens, ...) is silently dropped
 * instead of relying on every caller remembering to strip it.
 */
export function serializeRunTelemetryPayloadV2(payload: RunTelemetryPayloadV2): RunTelemetryPayloadV2 {
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    runId: capString(payload.runId, 200) ?? "",
    workflowKey: capString(payload.workflowKey, 200) ?? "",
    workflowTitle: capString(payload.workflowTitle),
    workflowFingerprint: capString(payload.workflowFingerprint, 128) ?? "",
    workflowNamespaceId: isUuidLike(payload.workflowNamespaceId) ? payload.workflowNamespaceId : null,
    workflowVersionId: isUuidLike(payload.workflowVersionId) ? payload.workflowVersionId : null,
    workflowVersionLabel: capString(payload.workflowVersionLabel, 100),
    workflowOrigin: payload.workflowOrigin === "remote" ? "remote" : "local",
    terminalState: allowedTerminalState(payload.terminalState),
    startedAt: typeof payload.startedAt === "string" ? payload.startedAt : new Date(0).toISOString(),
    endedAt: typeof payload.endedAt === "string" ? payload.endedAt : new Date(0).toISOString(),
    durationMs: nonNegativeInt(payload.durationMs),
    totalSteps: nonNegativeInt(payload.totalSteps),
    succeededSteps: nonNegativeInt(payload.succeededSteps),
    failedSteps: nonNegativeInt(payload.failedSteps),
    waitingSteps: nonNegativeInt(payload.waitingSteps),
    cancelledSteps: nonNegativeInt(payload.cancelledSteps),
    retriedSteps: nonNegativeInt(payload.retriedSteps),
    eventCount: nonNegativeInt(payload.eventCount),
    effectivenessScore: scoreInRange(payload.effectivenessScore),
    outputKeys: Array.isArray(payload.outputKeys) ? payload.outputKeys.map((key) => capString(key, 100) ?? "").filter(Boolean) : [],
    cliVersion: capString(payload.cliVersion, 50),
    runnerPlatform: allowedRunnerPlatform(payload.runnerPlatform),
    failureCategory: allowedFailureCategory(payload.failureCategory),
    failureReason: capString(payload.failureReason),
    steps: Array.isArray(payload.steps) ? payload.steps.slice(0, MAX_TELEMETRY_STEPS).map(serializeStepTelemetry) : [],
  };
}
