import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, requireMethod } from "../_shared/responses.ts";

export interface WorkflowRunInsightsDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireAuth: (context: AuthContext, scope?: string) => Promise<AuthContext> | AuthContext;
  loadInsights: (userId: string, workflowKey?: string) => Promise<{ items: Record<string, unknown>[] }>;
}

async function loadInsights(userId: string, workflowKey?: string): Promise<{ items: Record<string, unknown>[] }> {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  let query = service
    .from("workflow_run_telemetry")
    .select("workflow_key, workflow_title, terminal_state, total_steps, succeeded_steps, failed_steps, waiting_steps, cancelled_steps, retried_steps, event_count, duration_ms, effectiveness_score, output_keys, source_name, source_format, cli_version, failure_reason, created_at")
    .eq("actor_user_id", userId)
    .order("created_at", { ascending: false });
  if (workflowKey) {
    query = query.eq("workflow_key", workflowKey);
  }

  const { data, error } = await query.limit(200);
  if (error) {
    throw new HttpErrorClass(500, "Failed to load workflow run insights", error.message);
  }

  const grouped = new Map<string, typeof data>();
  for (const item of data ?? []) {
    const key = item.workflow_key;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  const items = Array.from(grouped.entries()).map(([key, runs]) => {
    const totalRuns = runs.length;
    const successfulRuns = runs.filter((run) => run.terminal_state === "succeeded").length;
    const failedRuns = runs.filter((run) => run.terminal_state === "failed").length;
    const approvalRuns = runs.filter((run) => run.terminal_state === "waiting_for_approval").length;
    const averageEffectiveness = totalRuns === 0 ? 0 : runs.reduce((sum, run) => sum + Number(run.effectiveness_score ?? 0), 0) / totalRuns;
    const averageDurationMs = totalRuns === 0 ? 0 : Math.round(runs.reduce((sum, run) => sum + Number(run.duration_ms ?? 0), 0) / totalRuns);
    const latest = runs[0];
    return {
      workflowKey: key,
      workflowTitle: latest?.workflow_title ?? null,
      totalRuns,
      successfulRuns,
      failedRuns,
      approvalRuns,
      successRate: totalRuns === 0 ? 0 : Math.round((successfulRuns / totalRuns) * 10000) / 100,
      averageEffectiveness: Math.round(averageEffectiveness * 100) / 100,
      averageDurationMs,
      lastRunAt: latest?.created_at ?? null,
      latestRun: latest,
      recentRuns: runs.slice(0, 5),
    };
  });

  return { items };
}

export async function handleWorkflowRunInsights(req: Request, deps?: Partial<WorkflowRunInsightsDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const resolvedDeps: WorkflowRunInsightsDeps = {
    resolveAuthContext: (request) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(request)),
    requireAuth: (context, scope) => import("../_shared/auth.ts").then((mod) => mod.requireAuth(context as never, scope) as AuthContext),
    loadInsights,
    ...deps,
  };

  try {
    requireMethod(req, "GET");
    const authContext = await resolvedDeps.requireAuth(await resolvedDeps.resolveAuthContext(req), "workflow:read");
    const workflowKey = new URL(req.url).searchParams.get("workflowKey")?.trim();
    return jsonResponse(await resolvedDeps.loadInsights(authContext.userId!, workflowKey || undefined));
  } catch (error) {
    if (error instanceof HttpErrorClass) {
      return errorResponse(error.message, error.status, error.details);
    }
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
