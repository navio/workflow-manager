import fs from "node:fs";
import path from "node:path";
import type { RunResult, StepRun, WorkflowDefinition } from "../types.js";
import { resolveAuthToken, resolveTelemetryPreference } from "./config.js";
import { trackRunTelemetryV2 } from "./api.js";
import {
  buildStepTelemetryPayloads,
  classifyFailure,
  serializeRunTelemetryPayloadV2,
  TELEMETRY_SCHEMA_VERSION,
  type RunnerPlatform,
  type RunTelemetryPayloadV2,
  type TelemetryTerminalState,
} from "./observability.js";
import { resolveWorkflowProvenance } from "./workflowProvenance.js";

interface RunTelemetryOptions {
  definition: WorkflowDefinition;
  sourceFilePath: string;
  durationMs: number;
  result?: RunResult;
  failureReason?: string;
}

function cliVersion(): string | null {
  try {
    const packagePath = path.resolve(process.cwd(), "package.json");
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function runnerPlatform(): RunnerPlatform {
  const platform = process.platform;
  return platform === "darwin" || platform === "linux" || platform === "win32" ? platform : "unknown";
}

interface RunSummaryCounts {
  totalSteps: number;
  succeededSteps: number;
  failedSteps: number;
  waitingSteps: number;
  cancelledSteps: number;
  retriedSteps: number;
  effectivenessScore: number;
}

function summarizeStepRuns(definition: WorkflowDefinition, stepRuns: StepRun[]): RunSummaryCounts {
  const succeededSteps = stepRuns.filter((step) => step.status === "succeeded").length;
  const failedSteps = stepRuns.filter((step) => step.status === "failed").length;
  const waitingSteps = stepRuns.filter((step) => step.status === "waiting_for_approval").length;
  const cancelledSteps = stepRuns.filter((step) => step.status === "cancelled").length;
  const retriedSteps = stepRuns.reduce((sum, step) => sum + Math.max(step.attempt - 1, 0), 0);
  const totalSteps = definition.steps.length;
  const successRatio = totalSteps === 0 ? 0 : succeededSteps / totalSteps;
  const retryPenalty = totalSteps === 0 ? 0 : Math.min(retriedSteps / totalSteps, 1) * 20;
  const waitingPenalty = waitingSteps > 0 ? 15 : 0;
  const failurePenalty = failedSteps > 0 ? 35 : 0;
  const effectivenessScore = Math.max(0, Math.min(100, Math.round(successRatio * 100 - retryPenalty - waitingPenalty - failurePenalty)));
  return { totalSteps, succeededSteps, failedSteps, waitingSteps, cancelledSteps, retriedSteps, effectivenessScore };
}

/**
 * Builds the privacy-safe, versioned V2 telemetry payload. Timing/adapter/model fields
 * come from the engine-recorded RunResult, not a CLI-side wall clock, except for
 * preflight failures where no RunResult exists yet. The payload is passed through the
 * allow-list serializer before being returned, so this is also the last point at which
 * an accidental extra field (raw input/output, a prompt, a path, ...) could leak — and it
 * cannot, because the serializer only emits the fixed V2 shape.
 */
export function buildRunTelemetryPayloadV2(options: RunTelemetryOptions): RunTelemetryPayloadV2 {
  const { definition, sourceFilePath, durationMs, result, failureReason } = options;
  const stepRuns = result?.stepRuns ?? [];
  const counts = summarizeStepRuns(definition, stepRuns);
  const terminalState = (result?.status ?? "failed") as TelemetryTerminalState;
  const provenance = resolveWorkflowProvenance(sourceFilePath, definition);
  const nowIso = new Date().toISOString();
  const { category, reason } = classifyFailure(failureReason ?? (terminalState === "failed" ? "run failed" : undefined), terminalState);

  const payload: RunTelemetryPayloadV2 = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    runId: result?.runId ?? `failed-preflight:${definition.key}`,
    workflowKey: definition.key,
    workflowTitle: definition.title,
    workflowFingerprint: provenance.workflowFingerprint,
    workflowNamespaceId: provenance.namespaceId,
    workflowVersionId: provenance.workflowVersionId,
    workflowVersionLabel: provenance.versionLabel,
    workflowOrigin: provenance.origin,
    terminalState,
    startedAt: result?.startedAt ?? nowIso,
    endedAt: result?.endedAt ?? nowIso,
    durationMs,
    totalSteps: counts.totalSteps,
    succeededSteps: counts.succeededSteps,
    failedSteps: counts.failedSteps,
    waitingSteps: counts.waitingSteps,
    cancelledSteps: counts.cancelledSteps,
    retriedSteps: counts.retriedSteps,
    eventCount: result?.events.length ?? 0,
    effectivenessScore: counts.effectivenessScore,
    outputKeys: Object.keys(result?.outputs ?? {}),
    cliVersion: cliVersion(),
    runnerPlatform: runnerPlatform(),
    failureCategory: category,
    failureReason: reason,
    steps: buildStepTelemetryPayloads(definition, stepRuns),
  };

  return serializeRunTelemetryPayloadV2(payload);
}

/**
 * Best-effort, non-blocking telemetry emission: never sent for unauthenticated runs or
 * WFM_TELEMETRY=off, and a network/validation failure here can only print one warning to
 * stderr — it never changes the workflow's exit code or touches stdout (so `--json`
 * output stays machine-readable).
 */
export async function emitRunTelemetryBestEffort(options: RunTelemetryOptions): Promise<void> {
  if (!resolveAuthToken() || resolveTelemetryPreference() === "off") {
    return;
  }

  try {
    await trackRunTelemetryV2(buildRunTelemetryPayloadV2(options));
  } catch (error) {
    console.warn(`Telemetry warning: ${(error as Error).message}`);
  }
}
