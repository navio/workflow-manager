import fs from "node:fs";
import path from "node:path";
import type { RunResult, WorkflowDefinition } from "../types.js";
import { resolveAuthToken } from "./config.js";
import { trackRunTelemetry, type RunTelemetryPayload } from "./api.js";
import { resolveWorkflowProvenance } from "./workflowProvenance.js";

interface RunTelemetryOptions {
  definition: WorkflowDefinition;
  sourceFilePath: string;
  durationMs: number;
  result?: RunResult;
  failureReason?: string;
}

function workflowSourceFormat(filePath: string): "markdown" | "json" {
  return path.extname(filePath).toLowerCase() === ".json" ? "json" : "markdown";
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

export function buildRunTelemetryPayload(options: RunTelemetryOptions): RunTelemetryPayload {
  const { definition, sourceFilePath, durationMs, result, failureReason } = options;
  const stepRuns = result?.stepRuns ?? [];
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
  const terminalState = (result?.status ?? "failed") as RunTelemetryPayload["terminalState"];
  // Missing/invalid/mismatched sidecars resolve to "local" transparently; a locally
  // modified copy of a pulled workflow is never misattributed to the remote version it
  // no longer matches.
  const provenance = resolveWorkflowProvenance(sourceFilePath, definition);
  return {
    workflowKey: definition.key,
    workflowTitle: definition.title,
    runId: result?.runId ?? `failed-preflight:${definition.key}`,
    terminalState,
    totalSteps,
    succeededSteps,
    failedSteps,
    waitingSteps,
    cancelledSteps,
    retriedSteps,
    eventCount: result?.events.length ?? 0,
    durationMs,
    effectivenessScore,
    outputKeys: Object.keys(result?.outputs ?? {}),
    sourceName: path.basename(sourceFilePath),
    sourceFormat: workflowSourceFormat(sourceFilePath),
    cliVersion: cliVersion(),
    failureReason: failureReason ?? (terminalState === "failed" ? "run failed" : null),
    metadata: {
      workflowObjectives: definition.objectives ?? [],
      stepKeys: definition.steps.map((step) => step.key),
      outputCount: Object.keys(result?.outputs ?? {}).length,
      workflowOrigin: provenance.origin,
      workflowNamespaceId: provenance.namespaceId,
      workflowVersionId: provenance.workflowVersionId,
      workflowVersionLabel: provenance.versionLabel,
      workflowFingerprint: provenance.workflowFingerprint,
    },
  };
}

export async function emitRunTelemetryBestEffort(options: RunTelemetryOptions): Promise<void> {
  if (!resolveAuthToken()) {
    return;
  }

  try {
    await trackRunTelemetry(buildRunTelemetryPayload(options));
  } catch (error) {
    console.warn(`Telemetry warning: ${(error as Error).message}`);
  }
}
