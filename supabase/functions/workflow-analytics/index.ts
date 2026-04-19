import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleOptions, HttpError, jsonResponse, errorResponse, requireMethod } from "../_shared/responses.ts";
import { requireAuth, resolveAuthContext } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  try {
    requireMethod(req, "GET");
    const authContext = requireAuth(await resolveAuthContext(req), "workflow:read");
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug")?.trim().toLowerCase();

    const service = createServiceClient();
    let namespaceQuery = service
      .from("workflow_namespaces")
      .select("id, slug, title, visibility, updated_at")
      .eq("owner_user_id", authContext.userId)
      .order("updated_at", { ascending: false });
    if (slug) {
      namespaceQuery = namespaceQuery.eq("slug", slug);
    }

    const { data: namespaces, error: namespaceError } = await namespaceQuery;
    if (namespaceError) {
      throw new HttpError(500, "Failed to load analytics namespaces", namespaceError.message);
    }

    const namespaceIds = (namespaces ?? []).map((namespace) => namespace.id);
    if (namespaceIds.length === 0) {
      return jsonResponse({ items: [] });
    }

    const [{ data: dailyStats, error: dailyStatsError }, { data: versions, error: versionsError }, { data: events, error: eventsError }] =
      await Promise.all([
        service
          .from("workflow_daily_stats")
          .select("namespace_id, stat_date, downloads, unique_downloaders, last_downloaded_at")
          .in("namespace_id", namespaceIds)
          .order("stat_date", { ascending: false }),
        service
          .from("workflow_versions")
          .select("id, namespace_id, version_label, published_state, created_at")
          .in("namespace_id", namespaceIds)
          .order("created_at", { ascending: false }),
        service
          .from("workflow_download_events")
          .select("namespace_id, version_id, created_at")
          .in("namespace_id", namespaceIds)
          .order("created_at", { ascending: false }),
      ]);

    if (dailyStatsError) {
      throw new HttpError(500, "Failed to load daily stats", dailyStatsError.message);
    }
    if (versionsError) {
      throw new HttpError(500, "Failed to load workflow versions", versionsError.message);
    }
    if (eventsError) {
      throw new HttpError(500, "Failed to load download events", eventsError.message);
    }

    const statsByNamespace = new Map<string, Array<Record<string, unknown>>>();
    for (const stat of dailyStats ?? []) {
      const current = statsByNamespace.get(stat.namespace_id) ?? [];
      current.push(stat as unknown as Record<string, unknown>);
      statsByNamespace.set(stat.namespace_id, current);
    }

    const versionsByNamespace = new Map<string, Array<Record<string, unknown>>>();
    for (const version of versions ?? []) {
      const current = versionsByNamespace.get(version.namespace_id) ?? [];
      current.push(version as unknown as Record<string, unknown>);
      versionsByNamespace.set(version.namespace_id, current);
    }

    const eventsByNamespace = new Map<string, Array<Record<string, unknown>>>();
    for (const event of events ?? []) {
      const current = eventsByNamespace.get(event.namespace_id) ?? [];
      current.push(event as unknown as Record<string, unknown>);
      eventsByNamespace.set(event.namespace_id, current);
    }

    const items = (namespaces ?? []).map((namespace) => {
      const namespaceStats = statsByNamespace.get(namespace.id) ?? [];
      const namespaceVersions = versionsByNamespace.get(namespace.id) ?? [];
      const namespaceEvents = eventsByNamespace.get(namespace.id) ?? [];

      const totalDownloads = namespaceStats.reduce((sum, stat) => sum + Number(stat.downloads ?? 0), 0);
      const lastDownloadedAt = namespaceStats
        .map((stat) => String(stat.last_downloaded_at ?? ""))
        .filter(Boolean)
        .sort()
        .reverse()[0] ?? null;

      const downloadsByVersion = namespaceVersions.map((version) => ({
        version: version.version_label,
        publishedState: version.published_state,
        createdAt: version.created_at,
        downloads: namespaceEvents.filter((event) => event.version_id === version.id).length,
      }));

      return {
        slug: namespace.slug,
        title: namespace.title,
        visibility: namespace.visibility,
        updatedAt: namespace.updated_at,
        totalDownloads,
        lastDownloadedAt,
        dailyStats: namespaceStats,
        downloadsByVersion,
      };
    });

    return jsonResponse({ items });
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status, error.details);
    }

    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
});
