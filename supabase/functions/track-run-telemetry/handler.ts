import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, readJsonBody, requireMethod } from "../_shared/responses.ts";

interface TrackRunTelemetryBody {
  workflowKey?: string;
  workflowTitle?: string | null;
  runId?: string;
  terminalState?: string;
  totalSteps?: number;
  succeededSteps?: number;
  failedSteps?: number;
  waitingSteps?: number;
  cancelledSteps?: number;
  retriedSteps?: number;
  eventCount?: number;
  durationMs?: number;
  effectivenessScore?: number;
  outputKeys?: string[];
  sourceName?: string | null;
  sourceFormat?: string | null;
  cliVersion?: string | null;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TrackRunTelemetryDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireAuth: (context: AuthContext, scope?: string) => Promise<AuthContext> | AuthContext;
  enforceRateLimit: (req: Request, context: AuthContext) => Promise<string>;
  recordOperation: (entry: {
    action: string;
    status: "success" | "error" | "rate_limited";
    authContext: AuthContext;
    actorKey?: string;
    resourceType?: string;
    resourceId?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  insertTelemetry: (userId: string, authMethod: string, body: TrackRunTelemetryBody) => Promise<{ id: string; workflowKey: string; terminalState: string }>;
}

const allowedTerminalStates = new Set(["succeeded", "failed", "waiting_for_approval", "cancelled"]);

function normalizeCount(value: unknown, field: string): number {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count < 0) {
    throw new HttpErrorClass(400, `${field} must be a non-negative number`);
  }
  return Math.floor(count);
}

function normalizeScore(value: unknown): number {
  const score = Number(value ?? 0);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new HttpErrorClass(400, "effectivenessScore must be between 0 and 100");
  }
  return Math.round(score * 100) / 100;
}

async function insertTelemetry(userId: string, authMethod: string, body: TrackRunTelemetryBody) {
  const workflowKey = typeof body.workflowKey === "string" ? body.workflowKey.trim() : "";
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const terminalState = typeof body.terminalState === "string" ? body.terminalState.trim() : "";
  if (!workflowKey || !runId || !allowedTerminalStates.has(terminalState)) {
    throw new HttpErrorClass(400, "workflowKey, runId, and a valid terminalState are required");
  }

  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  const { data, error } = await service
    .from("workflow_run_telemetry")
    .insert({
      actor_user_id: userId,
      auth_method: authMethod,
      workflow_key: workflowKey,
      workflow_title: typeof body.workflowTitle === "string" ? body.workflowTitle.trim() : null,
      run_id: runId,
      terminal_state: terminalState,
      total_steps: normalizeCount(body.totalSteps, "totalSteps"),
      succeeded_steps: normalizeCount(body.succeededSteps, "succeededSteps"),
      failed_steps: normalizeCount(body.failedSteps, "failedSteps"),
      waiting_steps: normalizeCount(body.waitingSteps, "waitingSteps"),
      cancelled_steps: normalizeCount(body.cancelledSteps, "cancelledSteps"),
      retried_steps: normalizeCount(body.retriedSteps, "retriedSteps"),
      event_count: normalizeCount(body.eventCount, "eventCount"),
      duration_ms: normalizeCount(body.durationMs, "durationMs"),
      effectiveness_score: normalizeScore(body.effectivenessScore),
      output_keys: Array.isArray(body.outputKeys) ? body.outputKeys.map((entry) => String(entry)) : [],
      source_name: typeof body.sourceName === "string" ? body.sourceName.trim() : null,
      source_format: typeof body.sourceFormat === "string" ? body.sourceFormat.trim() : null,
      cli_version: typeof body.cliVersion === "string" ? body.cliVersion.trim() : null,
      failure_reason: typeof body.failureReason === "string" ? body.failureReason.trim() : null,
      metadata: body.metadata ?? {},
    })
    .select("id, workflow_key, terminal_state")
    .single();

  if (error) {
    throw new HttpErrorClass(500, "Failed to record workflow run telemetry", error.message);
  }

  return {
    id: data.id,
    workflowKey: data.workflow_key,
    terminalState: data.terminal_state,
  };
}

export async function handleTrackRunTelemetry(req: Request, deps?: Partial<TrackRunTelemetryDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const resolvedDeps: TrackRunTelemetryDeps = {
    resolveAuthContext: (request) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(request)),
    requireAuth: (context, scope) => import("../_shared/auth.ts").then((mod) => mod.requireAuth(context as never, scope) as AuthContext),
    enforceRateLimit: (request, context) => import("../_shared/ops.ts").then((mod) => mod.enforceRateLimit(request, context, { action: "track_run_telemetry", maxRequests: 600, windowSeconds: 3600 })),
    recordOperation: (entry) => import("../_shared/ops.ts").then((mod) => mod.recordOperation(entry)),
    insertTelemetry,
    ...deps,
  };

  let authContext: AuthContext | null = null;
  let actorKey: string | undefined;
  try {
    requireMethod(req, "POST");
    authContext = await resolvedDeps.requireAuth(await resolvedDeps.resolveAuthContext(req), "workflow:write");
    actorKey = await resolvedDeps.enforceRateLimit(req, authContext);
    const body = await readJsonBody<TrackRunTelemetryBody>(req);
    const created = await resolvedDeps.insertTelemetry(authContext.userId!, authContext.method, body);
    await resolvedDeps.recordOperation({
      action: "track_run_telemetry",
      status: "success",
      authContext,
      actorKey,
      resourceType: "workflow_run_telemetry",
      resourceId: created.id,
      metadata: { workflowKey: created.workflowKey, terminalState: created.terminalState },
    });
    return jsonResponse(created, 201);
  } catch (error) {
    if (authContext) {
      await resolvedDeps.recordOperation({
        action: "track_run_telemetry",
        status: error instanceof HttpErrorClass && error.status === 429 ? "rate_limited" : "error",
        authContext,
        actorKey,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (error instanceof HttpErrorClass) {
      return errorResponse(error.message, error.status, error.details);
    }
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
