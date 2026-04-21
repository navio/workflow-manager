import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, requireMethod } from "../_shared/responses.ts";

export interface RefreshWorkflowStatsDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireAuth: (context: AuthContext, scope?: string) => Promise<AuthContext> | AuthContext;
  refreshStats: (userId: string, slug?: string) => Promise<{ processed: number }>;
}

async function refreshStats(userId: string, slug?: string): Promise<{ processed: number }> {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  let namespaceQuery = service.from("workflow_namespaces").select("id, slug").eq("owner_user_id", userId);
  if (slug) {
    namespaceQuery = namespaceQuery.eq("slug", slug);
  }
  const { data: namespaces, error: namespaceError } = await namespaceQuery;
  if (namespaceError) throw new HttpErrorClass(500, "Failed to load workflows for stats refresh", namespaceError.message);

  let processed = 0;
  for (const namespace of namespaces ?? []) {
    const { data, error } = await service.rpc("refresh_workflow_daily_stats", {
      p_namespace_id: namespace.id,
    });
    if (error) throw new HttpErrorClass(500, `Failed to refresh workflow stats for ${namespace.slug}`, error.message);
    processed += Number(data ?? 0);
  }

  return { processed };
}

export async function handleRefreshWorkflowStats(req: Request, deps?: Partial<RefreshWorkflowStatsDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const resolvedDeps: RefreshWorkflowStatsDeps = {
    resolveAuthContext: (request) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(request)),
    requireAuth: (context, scope) => import("../_shared/auth.ts").then((mod) => mod.requireAuth(context as never, scope) as AuthContext),
    refreshStats,
    ...deps,
  };

  try {
    requireMethod(req, "POST");
    const authContext = await resolvedDeps.requireAuth(await resolvedDeps.resolveAuthContext(req), "workflow:read");
    const slug = new URL(req.url).searchParams.get("slug")?.trim().toLowerCase();
    return jsonResponse(await resolvedDeps.refreshStats(authContext.userId!, slug));
  } catch (error) {
    if (error instanceof HttpErrorClass) return errorResponse(error.message, error.status, error.details);
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
