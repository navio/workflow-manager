import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, requireMethod } from "../_shared/responses.ts";

export interface WorkflowAnalyticsDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireAuth: (context: AuthContext, scope?: string) => Promise<AuthContext> | AuthContext;
  loadAnalytics: (userId: string, slug?: string) => Promise<{ items: Record<string, unknown>[] }>;
}

async function loadAnalytics(userId: string, slug?: string) {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  let namespaceQuery = service.from("workflow_namespaces").select("id, slug, title, visibility, updated_at").eq("owner_user_id", userId).order("updated_at", { ascending: false });
  if (slug) namespaceQuery = namespaceQuery.eq("slug", slug);
  const { data: namespaces, error: namespaceError } = await namespaceQuery;
  if (namespaceError) throw new HttpErrorClass(500, "Failed to load analytics namespaces", namespaceError.message);
  const namespaceIds = (namespaces ?? []).map((namespace) => namespace.id);
  if (namespaceIds.length === 0) return { items: [] };
  const [{ data: dailyStats, error: dailyStatsError }, { data: versions, error: versionsError }, { data: events, error: eventsError }] = await Promise.all([
    service.from("workflow_daily_stats").select("namespace_id, stat_date, downloads, unique_downloaders, last_downloaded_at").in("namespace_id", namespaceIds).order("stat_date", { ascending: false }),
    service.from("workflow_versions").select("id, namespace_id, version_label, published_state, created_at").in("namespace_id", namespaceIds).order("created_at", { ascending: false }),
    service.from("workflow_download_events").select("namespace_id, version_id, created_at").in("namespace_id", namespaceIds).order("created_at", { ascending: false }),
  ]);
  if (dailyStatsError) throw new HttpErrorClass(500, "Failed to load daily stats", dailyStatsError.message);
  if (versionsError) throw new HttpErrorClass(500, "Failed to load workflow versions", versionsError.message);
  if (eventsError) throw new HttpErrorClass(500, "Failed to load download events", eventsError.message);
  const statsByNamespace = new Map<string, Array<Record<string, unknown>>>();
  for (const stat of dailyStats ?? []) statsByNamespace.set(stat.namespace_id, [...(statsByNamespace.get(stat.namespace_id) ?? []), stat as unknown as Record<string, unknown>]);
  const versionsByNamespace = new Map<string, Array<Record<string, unknown>>>();
  for (const version of versions ?? []) versionsByNamespace.set(version.namespace_id, [...(versionsByNamespace.get(version.namespace_id) ?? []), version as unknown as Record<string, unknown>]);
  const eventsByNamespace = new Map<string, Array<Record<string, unknown>>>();
  for (const event of events ?? []) eventsByNamespace.set(event.namespace_id, [...(eventsByNamespace.get(event.namespace_id) ?? []), event as unknown as Record<string, unknown>]);
  const items = (namespaces ?? []).map((namespace) => {
    const namespaceStats = statsByNamespace.get(namespace.id) ?? [];
    const namespaceVersions = versionsByNamespace.get(namespace.id) ?? [];
    const namespaceEvents = eventsByNamespace.get(namespace.id) ?? [];
    const totalDownloads = namespaceStats.reduce((sum, stat) => sum + Number(stat.downloads ?? 0), 0);
    const lastDownloadedAt = namespaceStats.map((stat) => String(stat.last_downloaded_at ?? "")).filter(Boolean).sort().reverse()[0] ?? null;
    const downloadsByVersion = namespaceVersions.map((version) => ({ version: version.version_label, publishedState: version.published_state, createdAt: version.created_at, downloads: namespaceEvents.filter((event) => event.version_id === version.id).length }));
    return { slug: namespace.slug, title: namespace.title, visibility: namespace.visibility, updatedAt: namespace.updated_at, totalDownloads, lastDownloadedAt, dailyStats: namespaceStats, downloadsByVersion };
  });
  return { items };
}

export async function handleWorkflowAnalytics(req: Request, deps?: Partial<WorkflowAnalyticsDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  const resolvedDeps: WorkflowAnalyticsDeps = {
    resolveAuthContext: (req) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(req)),
    requireAuth: (context, scope) => import("../_shared/auth.ts").then((mod) => mod.requireAuth(context as never, scope) as AuthContext),
    loadAnalytics,
    ...deps,
  };
  try {
    requireMethod(req, "GET");
    const authContext = await resolvedDeps.requireAuth(await resolvedDeps.resolveAuthContext(req), "workflow:read");
    const slug = new URL(req.url).searchParams.get("slug")?.trim().toLowerCase();
    return jsonResponse(await resolvedDeps.loadAnalytics(authContext.userId!, slug));
  } catch (error) {
    if (error instanceof HttpErrorClass) return errorResponse(error.message, error.status, error.details);
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
