import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, requireMethod } from "../_shared/responses.ts";

export const MINIMUM_COHORT = 5;
const ALLOWED_WINDOW_DAYS = new Set([7, 30, 90]);
const DEFAULT_WINDOW_DAYS = 30;

export interface AggregateWindow {
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  waitingRuns: number;
  cancelledRuns: number;
  retriedRuns: number;
  successRate: number;
  averageDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
}

export interface CommunityWindow extends AggregateWindow {
  distinctUsers: number | null;
  suppressed: boolean;
  minimumCohort: typeof MINIMUM_COHORT;
}

export interface RuntimeBreakdownEntry {
  // Null exactly when suppressed: a below-threshold segment's adapter/model choice is
  // itself identifying information and must never reach the response, even alongside
  // zeroed-out metrics.
  adapter: string | null;
  requestedModel: string | null;
  totalRuns: number;
  successRate: number;
  averageDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  suppressed: boolean;
}

export interface StepBreakdownEntry {
  // Null exactly when suppressed — see RuntimeBreakdownEntry.
  stepKey: string | null;
  adapter: string | null;
  requestedModel: string | null;
  totalExecutions: number;
  successRate: number;
  p50ExecutionDurationMs: number;
  p95ExecutionDurationMs: number;
  suppressed: boolean;
}

export interface WorkflowObservabilityResponse {
  workflow: { slug: string; versionLabel: string | null };
  owner: AggregateWindow;
  community: CommunityWindow;
  byRuntime: RuntimeBreakdownEntry[];
  steps: StepBreakdownEntry[];
}

interface RunAggregateRow {
  actorUserId: string;
  terminalState: string;
  durationMs: number;
  retriedSteps: number;
}

interface StepAggregateRow {
  actorUserId: string;
  adapter: string;
  requestedModel: string | null;
  stepKey: string;
  terminalStatus: string;
  executionDurationMs: number | null;
}

/** Nearest-rank percentile over an already-sorted-ascending array; null when empty. */
export function percentileOf(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const index = Math.min(sortedAscending.length - 1, Math.floor(p * sortedAscending.length));
  return sortedAscending[index];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Parses/validates the ?window= query param against the allow-listed 7/30/90 day range. */
export function parseWindowDays(value: string | null): number {
  if (!value) return DEFAULT_WINDOW_DAYS;
  const match = /^(\d+)d?$/.exec(value.trim());
  const days = match ? Number(match[1]) : Number.NaN;
  if (!ALLOWED_WINDOW_DAYS.has(days)) {
    throw new HttpErrorClass(400, "window must be one of: 7d, 30d, 90d");
  }
  return days;
}

/** Builds an unsuppressed aggregate window — used only for the owner's own runs, where
 * there is no cross-user privacy concern because the data is already the requester's own. */
export function buildOwnerWindow(rows: RunAggregateRow[]): AggregateWindow {
  const durations = rows.map((row) => row.durationMs).sort((a, b) => a - b);
  const succeededRuns = rows.filter((row) => row.terminalState === "succeeded").length;
  return {
    totalRuns: rows.length,
    succeededRuns,
    failedRuns: rows.filter((row) => row.terminalState === "failed").length,
    waitingRuns: rows.filter((row) => row.terminalState === "waiting_for_approval").length,
    cancelledRuns: rows.filter((row) => row.terminalState === "cancelled").length,
    retriedRuns: rows.filter((row) => row.retriedSteps > 0).length,
    successRate: rows.length === 0 ? 0 : round2((succeededRuns / rows.length) * 100),
    averageDurationMs: durations.length === 0 ? null : Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length),
    p50DurationMs: percentileOf(durations, 0.5),
    p95DurationMs: percentileOf(durations, 0.95),
  };
}

/**
 * Builds the anonymous community window across ALL users (including the owner) for a
 * namespace/version. Suppressed — every numeric field held back — until at least
 * MINIMUM_COHORT distinct authenticated users contributed a run; a suppressed response
 * never carries a low/misleading count, only `{ suppressed: true }`.
 */
export function buildCommunityWindow(rows: RunAggregateRow[]): CommunityWindow {
  const distinctUsers = new Set(rows.map((row) => row.actorUserId)).size;
  if (distinctUsers < MINIMUM_COHORT) {
    return {
      totalRuns: 0,
      succeededRuns: 0,
      failedRuns: 0,
      waitingRuns: 0,
      cancelledRuns: 0,
      retriedRuns: 0,
      successRate: 0,
      averageDurationMs: null,
      p50DurationMs: null,
      p95DurationMs: null,
      distinctUsers: null,
      suppressed: true,
      minimumCohort: MINIMUM_COHORT,
    };
  }

  return { ...buildOwnerWindow(rows), distinctUsers, suppressed: false, minimumCohort: MINIMUM_COHORT };
}

const SUPPRESSED_RUNTIME_ENTRY: RuntimeBreakdownEntry = {
  adapter: null,
  requestedModel: null,
  totalRuns: 0,
  successRate: 0,
  averageDurationMs: 0,
  p50DurationMs: 0,
  p95DurationMs: 0,
  suppressed: true,
};

const SUPPRESSED_STEP_ENTRY: StepBreakdownEntry = {
  stepKey: null,
  adapter: null,
  requestedModel: null,
  totalExecutions: 0,
  successRate: 0,
  p50ExecutionDurationMs: 0,
  p95ExecutionDurationMs: 0,
  suppressed: true,
};

/**
 * Groups step executions by (adapter, requestedModel) across all users. Each segment is
 * independently gated on MINIMUM_COHORT distinct users, even when the workflow overall
 * clears the threshold — a niche runtime combination could otherwise re-identify a single
 * user's choice of adapter/model. Below-threshold groups are never returned as their own
 * labeled row (that would leak the adapter/model choice itself, even with metrics
 * zeroed) — they are collapsed into at most one dimension-free `{ suppressed: true }`
 * placeholder shared across all suppressed groups.
 */
export function buildRuntimeBreakdown(rows: StepAggregateRow[]): RuntimeBreakdownEntry[] {
  const groups = new Map<string, StepAggregateRow[]>();
  for (const row of rows) {
    const key = `${row.adapter}::${row.requestedModel ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const visible: RuntimeBreakdownEntry[] = [];
  let hasSuppressedGroup = false;

  for (const [key, groupRows] of groups.entries()) {
    const [adapter, requestedModelRaw] = key.split("::");
    const requestedModel = requestedModelRaw || null;
    const distinctUsers = new Set(groupRows.map((row) => row.actorUserId)).size;
    if (distinctUsers < MINIMUM_COHORT) {
      hasSuppressedGroup = true;
      continue;
    }
    const durations = groupRows.map((row) => row.executionDurationMs ?? 0).sort((a, b) => a - b);
    const succeeded = groupRows.filter((row) => row.terminalStatus === "succeeded").length;
    visible.push({
      adapter,
      requestedModel,
      totalRuns: groupRows.length,
      successRate: round2((succeeded / groupRows.length) * 100),
      averageDurationMs: durations.length === 0 ? 0 : Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length),
      p50DurationMs: percentileOf(durations, 0.5) ?? 0,
      p95DurationMs: percentileOf(durations, 0.95) ?? 0,
      suppressed: false,
    });
  }

  if (hasSuppressedGroup) {
    visible.push({ ...SUPPRESSED_RUNTIME_ENTRY });
  }

  return visible;
}

/** Same suppression/collapsing rule as buildRuntimeBreakdown, grouped by (stepKey, adapter, model). */
export function buildStepBreakdown(rows: StepAggregateRow[]): StepBreakdownEntry[] {
  const groups = new Map<string, StepAggregateRow[]>();
  for (const row of rows) {
    const key = `${row.stepKey}::${row.adapter}::${row.requestedModel ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const visible: StepBreakdownEntry[] = [];
  let hasSuppressedGroup = false;

  for (const [key, groupRows] of groups.entries()) {
    const [stepKey, adapter, requestedModelRaw] = key.split("::");
    const requestedModel = requestedModelRaw || null;
    const distinctUsers = new Set(groupRows.map((row) => row.actorUserId)).size;
    if (distinctUsers < MINIMUM_COHORT) {
      hasSuppressedGroup = true;
      continue;
    }
    const durations = groupRows.map((row) => row.executionDurationMs ?? 0).sort((a, b) => a - b);
    const succeeded = groupRows.filter((row) => row.terminalStatus === "succeeded").length;
    visible.push({
      stepKey,
      adapter,
      requestedModel,
      totalExecutions: groupRows.length,
      successRate: round2((succeeded / groupRows.length) * 100),
      p50ExecutionDurationMs: percentileOf(durations, 0.5) ?? 0,
      p95ExecutionDurationMs: percentileOf(durations, 0.95) ?? 0,
      suppressed: false,
    });
  }

  if (hasSuppressedGroup) {
    visible.push({ ...SUPPRESSED_STEP_ENTRY });
  }

  return visible;
}

export interface WorkflowObservabilityDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireAuth: (context: AuthContext, scope?: string) => Promise<AuthContext> | AuthContext;
  loadObservability: (userId: string, slug: string, versionLabel: string | undefined, windowDays: number) => Promise<WorkflowObservabilityResponse>;
}

async function loadObservability(userId: string, slug: string, versionLabel: string | undefined, windowDays: number): Promise<WorkflowObservabilityResponse> {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();

  const { data: namespace, error: namespaceError } = await service
    .from("workflow_namespaces")
    .select("id, owner_user_id, slug, latest_version_id")
    .eq("slug", slug)
    .maybeSingle();
  if (namespaceError) throw new HttpErrorClass(500, "Failed to load workflow namespace", namespaceError.message);
  if (!namespace) throw new HttpErrorClass(404, "Workflow not found");
  if (namespace.owner_user_id !== userId) {
    throw new HttpErrorClass(403, "Only the workflow owner can view its observability data");
  }

  let versionQuery = service.from("workflow_versions").select("id, version_label").eq("namespace_id", namespace.id);
  versionQuery = versionLabel ? versionQuery.eq("version_label", versionLabel) : versionQuery.eq("id", namespace.latest_version_id ?? "");
  const { data: version, error: versionError } = await versionQuery.maybeSingle();
  if (versionError) throw new HttpErrorClass(500, "Failed to load workflow version", versionError.message);
  if (!version) throw new HttpErrorClass(404, "Workflow version not found");

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: ownerRows, error: ownerRowsError }, { data: communityRows, error: communityRowsError }, { data: stepRows, error: stepRowsError }] = await Promise.all([
    service
      .from("workflow_run_telemetry")
      .select("terminal_state, duration_ms, retried_steps")
      .eq("actor_user_id", userId)
      .eq("workflow_namespace_id", namespace.id)
      .eq("workflow_version_id", version.id)
      .gte("created_at", since),
    service
      .from("workflow_run_telemetry")
      .select("actor_user_id, terminal_state, duration_ms, retried_steps")
      .eq("workflow_namespace_id", namespace.id)
      .eq("workflow_version_id", version.id)
      .gte("created_at", since),
    service
      .from("workflow_step_telemetry")
      .select("actor_user_id, adapter, requested_model, step_key, terminal_status, execution_duration_ms")
      .eq("workflow_namespace_id", namespace.id)
      .eq("workflow_version_id", version.id)
      .gte("created_at", since),
  ]);
  if (ownerRowsError) throw new HttpErrorClass(500, "Failed to load owner run telemetry", ownerRowsError.message);
  if (communityRowsError) throw new HttpErrorClass(500, "Failed to load community run telemetry", communityRowsError.message);
  if (stepRowsError) throw new HttpErrorClass(500, "Failed to load step telemetry", stepRowsError.message);

  const ownerAggregateRows: RunAggregateRow[] = (ownerRows ?? []).map((row) => ({
    actorUserId: userId,
    terminalState: row.terminal_state,
    durationMs: Number(row.duration_ms ?? 0),
    retriedSteps: Number(row.retried_steps ?? 0),
  }));
  const communityAggregateRows: RunAggregateRow[] = (communityRows ?? []).map((row) => ({
    actorUserId: row.actor_user_id,
    terminalState: row.terminal_state,
    durationMs: Number(row.duration_ms ?? 0),
    retriedSteps: Number(row.retried_steps ?? 0),
  }));
  const stepAggregateRows: StepAggregateRow[] = (stepRows ?? []).map((row) => ({
    actorUserId: row.actor_user_id,
    adapter: row.adapter,
    requestedModel: row.requested_model ?? null,
    stepKey: row.step_key,
    terminalStatus: row.terminal_status,
    executionDurationMs: row.execution_duration_ms === null || row.execution_duration_ms === undefined ? null : Number(row.execution_duration_ms),
  }));

  return {
    workflow: { slug: namespace.slug, versionLabel: version.version_label },
    owner: buildOwnerWindow(ownerAggregateRows),
    community: buildCommunityWindow(communityAggregateRows),
    byRuntime: buildRuntimeBreakdown(stepAggregateRows),
    steps: buildStepBreakdown(stepAggregateRows),
  };
}

export async function handleWorkflowObservability(req: Request, deps?: Partial<WorkflowObservabilityDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const resolvedDeps: WorkflowObservabilityDeps = {
    resolveAuthContext: (request) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(request)),
    requireAuth: (context, scope) => import("../_shared/auth.ts").then((mod) => mod.requireAuth(context as never, scope) as AuthContext),
    loadObservability,
    ...deps,
  };

  try {
    requireMethod(req, "GET");
    const authContext = await resolvedDeps.requireAuth(await resolvedDeps.resolveAuthContext(req), "workflow:read");
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug")?.trim().toLowerCase();
    if (!slug) throw new HttpErrorClass(400, "slug query parameter is required");
    const versionLabel = url.searchParams.get("version")?.trim() || undefined;
    const windowDays = parseWindowDays(url.searchParams.get("window"));
    return jsonResponse(await resolvedDeps.loadObservability(authContext.userId!, slug, versionLabel, windowDays));
  } catch (error) {
    if (error instanceof HttpErrorClass) return errorResponse(error.message, error.status, error.details);
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
