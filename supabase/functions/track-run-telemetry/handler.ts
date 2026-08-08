import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, readJsonBody, requireMethod } from "../_shared/responses.ts";

// Kept in sync with src/types.ts AdapterKey plus the two non-agent step kinds
// ("approval"/"system") that observability.ts assigns instead of a real adapter.
const ALLOWED_ADAPTERS = new Set([
  "pi-agent",
  "mock",
  "opencode",
  "codex",
  "claude-code",
  "kimi",
  "gemini",
  "qwen",
  "acp",
  "approval",
  "system",
]);

const ALLOWED_TERMINAL_STATES = new Set(["succeeded", "failed", "waiting_for_approval", "cancelled"]);
const ALLOWED_ORIGINS = new Set(["remote", "local"]);
const ALLOWED_PLATFORMS = new Set(["darwin", "linux", "win32", "unknown"]);
const ALLOWED_FAILURE_CATEGORIES = new Set([
  "validation",
  "preflight",
  "adapter",
  "execution",
  "approval",
  "cancelled",
  "unknown",
]);
const ALLOWED_STEP_KINDS = new Set(["task", "approval", "system"]);
const ALLOWED_EXECUTION_STATUSES = new Set(["SUCCESS", "QA_REJECTED", "YIELD_EXTERNAL", "FAILED"]);
const ALLOWED_QA_ACTIONS = new Set(["PROCEED", "RETRY_CURRENT", "ROLLBACK_PREVIOUS", "RESTART_ALL"]);

const MAX_STEPS = 500;
const MAX_KEY_LENGTH = 200;
const MAX_TEXT_LENGTH = 300;
const MAX_MODEL_LENGTH = 100;
const MAX_ADAPTER_LENGTH = 40;
const MAX_VERSION_LABEL_LENGTH = 100;
const MAX_CLI_VERSION_LENGTH = 50;
const MAX_FINGERPRINT_LENGTH = 200;

// Every key a valid V2 body (or step record) may contain. Any other top-level key —
// including an attempted actorUserId, or a prohibited field like hostname/path/token —
// is rejected outright rather than silently dropped, so a malformed/malicious client
// gets clear, immediate feedback instead of a payload that quietly loses fields.
const ALLOWED_V2_RUN_KEYS = new Set([
  "schemaVersion",
  "runId",
  "workflowKey",
  "workflowTitle",
  "workflowFingerprint",
  "workflowNamespaceId",
  "workflowVersionId",
  "workflowVersionLabel",
  "workflowOrigin",
  "terminalState",
  "startedAt",
  "endedAt",
  "durationMs",
  "totalSteps",
  "succeededSteps",
  "failedSteps",
  "waitingSteps",
  "cancelledSteps",
  "retriedSteps",
  "eventCount",
  "effectivenessScore",
  "outputKeys",
  "cliVersion",
  "runnerPlatform",
  "failureCategory",
  "failureReason",
  "steps",
]);

const ALLOWED_V2_STEP_KEYS = new Set([
  "stepKey",
  "stepKind",
  "attempt",
  "terminalStatus",
  "adapter",
  "requestedModel",
  "startedAt",
  "endedAt",
  "executionDurationMs",
  "queueDurationMs",
  "executionStatus",
  "qaAction",
]);

// Legacy (pre-observability) fields accepted for one transition release window; see
// doc/guide/observability.md. Any body without `schemaVersion: 2` is treated as V1 and
// normalized into a run-only V2-shaped row (no step records, workflow_origin "local").
const ALLOWED_V1_RUN_KEYS = new Set([
  "workflowKey",
  "workflowTitle",
  "runId",
  "terminalState",
  "totalSteps",
  "succeededSteps",
  "failedSteps",
  "waitingSteps",
  "cancelledSteps",
  "retriedSteps",
  "eventCount",
  "durationMs",
  "effectivenessScore",
  "outputKeys",
  "sourceName",
  "sourceFormat",
  "cliVersion",
  "failureReason",
  "metadata",
]);

interface StepTelemetryBody {
  stepKey?: unknown;
  stepKind?: unknown;
  attempt?: unknown;
  terminalStatus?: unknown;
  adapter?: unknown;
  requestedModel?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  executionDurationMs?: unknown;
  queueDurationMs?: unknown;
  executionStatus?: unknown;
  qaAction?: unknown;
}

interface TrackRunTelemetryBody {
  schemaVersion?: unknown;
  [key: string]: unknown;
}

interface NormalizedRunRow {
  schemaVersion: 1 | 2;
  runId: string;
  workflowKey: string;
  workflowTitle: string | null;
  terminalState: string;
  totalSteps: number;
  succeededSteps: number;
  failedSteps: number;
  waitingSteps: number;
  cancelledSteps: number;
  retriedSteps: number;
  eventCount: number;
  durationMs: number;
  effectivenessScore: number;
  outputKeys: string[];
  cliVersion: string | null;
  failureReason: string | null;
  workflowFingerprint: string | null;
  workflowOrigin: string;
  workflowNamespaceId: string | null;
  workflowVersionId: string | null;
  workflowVersionLabel: string | null;
  startedAt: string | null;
  endedAt: string | null;
  runnerPlatform: string | null;
  failureCategory: string | null;
  sourceName: string | null;
  sourceFormat: string | null;
  metadata: Record<string, unknown>;
}

interface NormalizedStepRow {
  stepKey: string;
  stepKind: string;
  attempt: number;
  terminalStatus: string;
  adapter: string;
  requestedModel: string | null;
  startedAt: string | null;
  endedAt: string | null;
  executionDurationMs: number | null;
  queueDurationMs: number | null;
  executionStatus: string | null;
  qaAction: string | null;
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
  insertTelemetry: (
    userId: string,
    authMethod: string,
    run: NormalizedRunRow,
    steps: NormalizedStepRow[]
  ) => Promise<{ id: string; runId: string; terminalState: string; duplicate: boolean }>;
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowed: Set<string>): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return key;
    }
  }
  return null;
}

function requireNonEmptyString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpErrorClass(400, `${field} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new HttpErrorClass(400, `${field} must be at most ${maxLength} characters`);
  }
  return value;
}

function optionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HttpErrorClass(400, `${field} must be a string or null`);
  }
  if (value.length > maxLength) {
    throw new HttpErrorClass(400, `${field} must be at most ${maxLength} characters`);
  }
  return value;
}

function requireEnum(value: unknown, field: string, allowed: Set<string>): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new HttpErrorClass(400, `${field} must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function optionalEnum(value: unknown, field: string, allowed: Set<string>): string | null {
  if (value === undefined || value === null) return null;
  return requireEnum(value, field, allowed);
}

function requireNonNegativeInt(value: unknown, field: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
    throw new HttpErrorClass(400, `${field} must be a non-negative integer`);
  }
  return num;
}

function optionalNonNegativeInt(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  return requireNonNegativeInt(value, field);
}

function requireScore(value: unknown, field: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw new HttpErrorClass(400, `${field} must be between 0 and 100`);
  }
  return Math.round(num * 100) / 100;
}

function requireIsoTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new HttpErrorClass(400, `${field} must be a valid ISO timestamp`);
  }
  return value;
}

function optionalIsoTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireIsoTimestamp(value, field);
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpErrorClass(400, `${field} must be a valid UUID`);
  }
  return value;
}

function requireOutputKeys(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HttpErrorClass(400, "outputKeys must be an array of strings");
  }
  return value.map((entry, index) => requireNonEmptyString(entry, `outputKeys[${index}]`, MAX_MODEL_LENGTH));
}

function normalizeStep(raw: unknown, index: number): NormalizedStepRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpErrorClass(400, `steps[${index}] must be an object`);
  }
  const extraKey = hasOnlyAllowedKeys(raw as Record<string, unknown>, ALLOWED_V2_STEP_KEYS);
  if (extraKey) {
    throw new HttpErrorClass(400, `steps[${index}] contains an unsupported field: ${extraKey}`);
  }
  const step = raw as StepTelemetryBody;
  const stepKind = requireEnum(step.stepKind, `steps[${index}].stepKind`, ALLOWED_STEP_KINDS);
  const adapter = requireNonEmptyString(step.adapter, `steps[${index}].adapter`, MAX_ADAPTER_LENGTH);
  if (!ALLOWED_ADAPTERS.has(adapter)) {
    throw new HttpErrorClass(400, `steps[${index}].adapter is not a supported adapter: ${adapter}`);
  }
  if ((stepKind === "approval" || stepKind === "system") && adapter !== stepKind) {
    throw new HttpErrorClass(400, `steps[${index}].adapter must be "${stepKind}" for a ${stepKind} step`);
  }
  const attempt = requireNonNegativeInt(step.attempt, `steps[${index}].attempt`);
  if (attempt < 1) {
    throw new HttpErrorClass(400, `steps[${index}].attempt must be at least 1`);
  }

  return {
    stepKey: requireNonEmptyString(step.stepKey, `steps[${index}].stepKey`, MAX_KEY_LENGTH),
    stepKind,
    attempt,
    terminalStatus: requireEnum(step.terminalStatus, `steps[${index}].terminalStatus`, ALLOWED_TERMINAL_STATES),
    adapter,
    requestedModel: stepKind === "task" ? optionalString(step.requestedModel, `steps[${index}].requestedModel`, MAX_MODEL_LENGTH) : null,
    startedAt: optionalIsoTimestamp(step.startedAt, `steps[${index}].startedAt`),
    endedAt: optionalIsoTimestamp(step.endedAt, `steps[${index}].endedAt`),
    executionDurationMs: optionalNonNegativeInt(step.executionDurationMs, `steps[${index}].executionDurationMs`),
    queueDurationMs: optionalNonNegativeInt(step.queueDurationMs, `steps[${index}].queueDurationMs`),
    executionStatus: optionalEnum(step.executionStatus, `steps[${index}].executionStatus`, ALLOWED_EXECUTION_STATUSES),
    qaAction: optionalEnum(step.qaAction, `steps[${index}].qaAction`, ALLOWED_QA_ACTIONS),
  };
}

function normalizeV2Body(body: TrackRunTelemetryBody): { run: NormalizedRunRow; steps: NormalizedStepRow[] } {
  const extraKey = hasOnlyAllowedKeys(body, ALLOWED_V2_RUN_KEYS);
  if (extraKey) {
    throw new HttpErrorClass(400, `Request body contains an unsupported field: ${extraKey}`);
  }

  const stepsRaw = body.steps;
  if (stepsRaw !== undefined && !Array.isArray(stepsRaw)) {
    throw new HttpErrorClass(400, "steps must be an array");
  }
  if (Array.isArray(stepsRaw) && stepsRaw.length > MAX_STEPS) {
    throw new HttpErrorClass(400, `steps must contain at most ${MAX_STEPS} records`);
  }
  const steps = (stepsRaw ?? []).map((step, index) => normalizeStep(step, index));

  const run: NormalizedRunRow = {
    schemaVersion: 2,
    runId: requireNonEmptyString(body.runId, "runId", MAX_KEY_LENGTH),
    workflowKey: requireNonEmptyString(body.workflowKey, "workflowKey", MAX_KEY_LENGTH),
    workflowTitle: optionalString(body.workflowTitle, "workflowTitle", MAX_TEXT_LENGTH),
    terminalState: requireEnum(body.terminalState, "terminalState", ALLOWED_TERMINAL_STATES),
    totalSteps: requireNonNegativeInt(body.totalSteps, "totalSteps"),
    succeededSteps: requireNonNegativeInt(body.succeededSteps, "succeededSteps"),
    failedSteps: requireNonNegativeInt(body.failedSteps, "failedSteps"),
    waitingSteps: requireNonNegativeInt(body.waitingSteps, "waitingSteps"),
    cancelledSteps: requireNonNegativeInt(body.cancelledSteps, "cancelledSteps"),
    retriedSteps: requireNonNegativeInt(body.retriedSteps, "retriedSteps"),
    eventCount: requireNonNegativeInt(body.eventCount, "eventCount"),
    durationMs: requireNonNegativeInt(body.durationMs, "durationMs"),
    effectivenessScore: requireScore(body.effectivenessScore, "effectivenessScore"),
    outputKeys: requireOutputKeys(body.outputKeys),
    cliVersion: optionalString(body.cliVersion, "cliVersion", MAX_CLI_VERSION_LENGTH),
    failureReason: optionalString(body.failureReason, "failureReason", MAX_TEXT_LENGTH),
    workflowFingerprint: requireNonEmptyString(body.workflowFingerprint, "workflowFingerprint", MAX_FINGERPRINT_LENGTH),
    workflowOrigin: requireEnum(body.workflowOrigin, "workflowOrigin", ALLOWED_ORIGINS),
    workflowNamespaceId: optionalUuid(body.workflowNamespaceId, "workflowNamespaceId"),
    workflowVersionId: optionalUuid(body.workflowVersionId, "workflowVersionId"),
    workflowVersionLabel: optionalString(body.workflowVersionLabel, "workflowVersionLabel", MAX_VERSION_LABEL_LENGTH),
    startedAt: requireIsoTimestamp(body.startedAt, "startedAt"),
    endedAt: requireIsoTimestamp(body.endedAt, "endedAt"),
    runnerPlatform: requireEnum(body.runnerPlatform, "runnerPlatform", ALLOWED_PLATFORMS),
    failureCategory: optionalEnum(body.failureCategory, "failureCategory", ALLOWED_FAILURE_CATEGORIES),
    sourceName: null,
    sourceFormat: null,
    metadata: {},
  };

  if (run.workflowOrigin === "remote" && (!run.workflowNamespaceId || !run.workflowVersionId)) {
    throw new HttpErrorClass(400, 'workflowNamespaceId and workflowVersionId are required when workflowOrigin is "remote"');
  }
  if (run.workflowOrigin === "local" && (run.workflowNamespaceId || run.workflowVersionId)) {
    throw new HttpErrorClass(400, 'workflowNamespaceId/workflowVersionId must be omitted when workflowOrigin is "local"');
  }

  return { run, steps };
}

// V1 clients (pre-dating this schema) are normalized into a run-only V2-shaped record:
// no step telemetry, workflow_origin always "local" (V1 never had provenance), and
// schema_version 1 so downstream aggregate queries can distinguish and, if desired,
// exclude legacy rows. Supported for one release window; see doc/guide/observability.md.
function normalizeV1Body(body: TrackRunTelemetryBody): { run: NormalizedRunRow; steps: NormalizedStepRow[] } {
  const extraKey = hasOnlyAllowedKeys(body, ALLOWED_V1_RUN_KEYS);
  if (extraKey) {
    throw new HttpErrorClass(400, `Request body contains an unsupported field: ${extraKey}`);
  }

  const terminalState = requireEnum(body.terminalState, "terminalState", ALLOWED_TERMINAL_STATES);
  const nowIso = new Date().toISOString();
  const durationMs = requireNonNegativeInt(body.durationMs, "durationMs");

  const run: NormalizedRunRow = {
    schemaVersion: 1,
    runId: requireNonEmptyString(body.runId, "runId", MAX_KEY_LENGTH),
    workflowKey: requireNonEmptyString(body.workflowKey, "workflowKey", MAX_KEY_LENGTH),
    workflowTitle: optionalString(body.workflowTitle, "workflowTitle", MAX_TEXT_LENGTH),
    terminalState,
    totalSteps: requireNonNegativeInt(body.totalSteps, "totalSteps"),
    succeededSteps: requireNonNegativeInt(body.succeededSteps, "succeededSteps"),
    failedSteps: requireNonNegativeInt(body.failedSteps, "failedSteps"),
    waitingSteps: requireNonNegativeInt(body.waitingSteps, "waitingSteps"),
    cancelledSteps: requireNonNegativeInt(body.cancelledSteps, "cancelledSteps"),
    retriedSteps: requireNonNegativeInt(body.retriedSteps, "retriedSteps"),
    eventCount: requireNonNegativeInt(body.eventCount, "eventCount"),
    durationMs,
    effectivenessScore: requireScore(body.effectivenessScore, "effectivenessScore"),
    outputKeys: requireOutputKeys(body.outputKeys),
    cliVersion: optionalString(body.cliVersion, "cliVersion", MAX_CLI_VERSION_LENGTH),
    failureReason: optionalString(body.failureReason, "failureReason", MAX_TEXT_LENGTH),
    workflowFingerprint: null,
    workflowOrigin: "local",
    workflowNamespaceId: null,
    workflowVersionId: null,
    workflowVersionLabel: null,
    startedAt: nowIso,
    endedAt: nowIso,
    runnerPlatform: "unknown",
    failureCategory: null,
    sourceName: optionalString(body.sourceName, "sourceName", MAX_TEXT_LENGTH),
    sourceFormat: optionalString(body.sourceFormat, "sourceFormat", 20),
    metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? (body.metadata as Record<string, unknown>) : {},
  };

  return { run, steps: [] };
}

// Decides whether a claimed "remote" attribution survives a server-side check that the
// claimed version actually belongs to the claimed namespace. `actualVersionNamespaceId`
// is whatever the database says workflowVersionId's namespace_id is (null if the version
// row no longer exists, e.g. it was deleted). A stale or spoofed claim degrades silently
// to "local" rather than rejecting the whole submission — a client's local provenance
// sidecar can go stale (deleted/moved workflow) without that being the runner's fault.
export function resolveEffectiveProvenance(run: NormalizedRunRow, actualVersionNamespaceId: string | null): NormalizedRunRow {
  if (run.workflowOrigin !== "remote") {
    return run;
  }
  if (actualVersionNamespaceId && actualVersionNamespaceId === run.workflowNamespaceId) {
    return run;
  }
  return { ...run, workflowOrigin: "local", workflowNamespaceId: null, workflowVersionId: null, workflowVersionLabel: null };
}

async function insertTelemetry(
  userId: string,
  authMethod: string,
  run: NormalizedRunRow,
  steps: NormalizedStepRow[]
): Promise<{ id: string; runId: string; terminalState: string; duplicate: boolean }> {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();

  if (run.workflowOrigin === "remote" && run.workflowVersionId) {
    const { data: versionRow } = await service.from("workflow_versions").select("namespace_id").eq("id", run.workflowVersionId).maybeSingle();
    run = resolveEffectiveProvenance(run, versionRow?.namespace_id ?? null);
  }

  const { data: inserted, error: insertError } = await service
    .from("workflow_run_telemetry")
    .insert({
      actor_user_id: userId,
      auth_method: authMethod,
      workflow_key: run.workflowKey,
      workflow_title: run.workflowTitle,
      run_id: run.runId,
      terminal_state: run.terminalState,
      total_steps: run.totalSteps,
      succeeded_steps: run.succeededSteps,
      failed_steps: run.failedSteps,
      waiting_steps: run.waitingSteps,
      cancelled_steps: run.cancelledSteps,
      retried_steps: run.retriedSteps,
      event_count: run.eventCount,
      duration_ms: run.durationMs,
      effectiveness_score: run.effectivenessScore,
      output_keys: run.outputKeys,
      source_name: run.sourceName,
      source_format: run.sourceFormat,
      cli_version: run.cliVersion,
      failure_reason: run.failureReason,
      metadata: run.metadata,
      schema_version: run.schemaVersion,
      workflow_fingerprint: run.workflowFingerprint,
      workflow_origin: run.workflowOrigin,
      workflow_namespace_id: run.workflowNamespaceId,
      workflow_version_id: run.workflowVersionId,
      workflow_version_label: run.workflowVersionLabel,
      started_at: run.startedAt,
      ended_at: run.endedAt,
      runner_platform: run.runnerPlatform,
      failure_category: run.failureCategory,
    })
    .select("id, run_id, terminal_state")
    .single();

  if (insertError) {
    // Postgres unique_violation on (actor_user_id, run_id): this exact run was already
    // recorded (retry/duplicate submission). Return the prior row rather than erroring —
    // the CLI's Idempotency-Key means a duplicate is expected, not exceptional.
    if (insertError.code === "23505") {
      const { data: existing, error: fetchError } = await service
        .from("workflow_run_telemetry")
        .select("id, run_id, terminal_state")
        .eq("actor_user_id", userId)
        .eq("run_id", run.runId)
        .single();
      if (fetchError || !existing) {
        throw new HttpErrorClass(500, "Failed to load existing workflow run telemetry", fetchError?.message);
      }
      return { id: existing.id, runId: existing.run_id, terminalState: existing.terminal_state, duplicate: true };
    }
    throw new HttpErrorClass(500, "Failed to record workflow run telemetry", insertError.message);
  }

  if (steps.length > 0) {
    const stepRows = steps.map((step) => ({
      run_telemetry_id: inserted.id,
      actor_user_id: userId,
      workflow_namespace_id: run.workflowNamespaceId,
      workflow_version_id: run.workflowVersionId,
      step_key: step.stepKey,
      step_kind: step.stepKind,
      attempt: step.attempt,
      terminal_status: step.terminalStatus,
      adapter: step.adapter,
      requested_model: step.requestedModel,
      started_at: step.startedAt,
      ended_at: step.endedAt,
      execution_duration_ms: step.executionDurationMs,
      queue_duration_ms: step.queueDurationMs,
      execution_status: step.executionStatus,
      qa_action: step.qaAction,
    }));

    const { error: stepsError } = await service.from("workflow_step_telemetry").insert(stepRows);
    if (stepsError) {
      // Compensating delete: never leave a run row on record without the step rows it
      // claimed to have, since the run summary and its steps must succeed/fail together.
      await service.from("workflow_run_telemetry").delete().eq("id", inserted.id);
      throw new HttpErrorClass(500, "Failed to record workflow step telemetry", stepsError.message);
    }
  }

  return { id: inserted.id, runId: inserted.run_id, terminalState: inserted.terminal_state, duplicate: false };
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpErrorClass(400, "Request body must be a JSON object");
    }

    const { run, steps } = body.schemaVersion === 2 ? normalizeV2Body(body) : normalizeV1Body(body);
    const created = await resolvedDeps.insertTelemetry(authContext.userId!, authContext.method, run, steps);
    await resolvedDeps.recordOperation({
      action: "track_run_telemetry",
      status: "success",
      authContext,
      actorKey,
      resourceType: "workflow_run_telemetry",
      resourceId: created.id,
      metadata: { schemaVersion: run.schemaVersion, terminalState: created.terminalState, stepCount: steps.length, duplicate: created.duplicate },
    });
    return jsonResponse(created, created.duplicate ? 200 : 201);
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
