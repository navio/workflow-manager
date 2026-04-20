import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, requireMethod } from "../_shared/responses.ts";

export interface SearchWorkflowsDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  search: (authContext: AuthContext, query: string, limit: number) => Promise<{ items: Record<string, unknown>[]; count: number; query: string }>;
}

async function search(authContext: AuthContext, q: string, limit: number) {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  let query = service.from("workflow_namespaces").select("id, owner_user_id, slug, title, description, visibility, latest_version_id, created_at, updated_at").order("updated_at", { ascending: false }).limit(limit);
  if (authContext.userId) query = query.or(`visibility.eq.public,owner_user_id.eq.${authContext.userId}`);
  else query = query.eq("visibility", "public");
  const { data: namespaces, error: namespaceError } = await query;
  if (namespaceError) throw new HttpErrorClass(500, "Failed to search workflows", namespaceError.message);
  const ownerIds = [...new Set((namespaces ?? []).map((row) => row.owner_user_id))];
  const latestVersionIds = [...new Set((namespaces ?? []).map((row) => row.latest_version_id).filter(Boolean))];
  const [{ data: profiles, error: profilesError }, { data: versions, error: versionsError }] = await Promise.all([
    ownerIds.length > 0 ? service.from("profiles").select("id, username, display_name").in("id", ownerIds) : Promise.resolve({ data: [], error: null }),
    latestVersionIds.length > 0 ? service.from("workflow_versions").select("id, version_label, source_format, published_state, created_at").in("id", latestVersionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesError) throw new HttpErrorClass(500, "Failed to load workflow owners", profilesError.message);
  if (versionsError) throw new HttpErrorClass(500, "Failed to load workflow versions", versionsError.message);
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const versionById = new Map((versions ?? []).map((version) => [version.id, version]));
  const loweredQuery = q.toLowerCase();
  const items = (namespaces ?? []).map((namespace) => {
    const version = namespace.latest_version_id ? versionById.get(namespace.latest_version_id) : null;
    const isOwner = authContext.userId === namespace.owner_user_id;
    const isPublicReadable = namespace.visibility === "public" && version?.published_state === "published";
    if (!isOwner && !isPublicReadable) return null;
    const ownerProfile = profileById.get(namespace.owner_user_id);
    return { owner: ownerProfile?.username ?? namespace.owner_user_id, ownerDisplayName: ownerProfile?.display_name ?? null, slug: namespace.slug, title: namespace.title, description: namespace.description, visibility: isOwner ? namespace.visibility : "public", latestVersion: version?.version_label ?? null, sourceFormat: version?.source_format ?? null, publishedState: version?.published_state ?? null, updatedAt: namespace.updated_at, createdAt: namespace.created_at };
  }).filter((item) => {
    if (!item || !loweredQuery) return true;
    return [item.slug, item.title, item.description ?? "", item.owner, item.ownerDisplayName ?? ""].join(" ").toLowerCase().includes(loweredQuery);
  }).filter(Boolean) as Record<string, unknown>[];
  return { items, count: items.length, query: q };
}

export async function handleSearchWorkflows(req: Request, deps?: Partial<SearchWorkflowsDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  const resolvedDeps: SearchWorkflowsDeps = { resolveAuthContext: (req) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(req)), search, ...deps };
  try {
    requireMethod(req, "GET");
    const authContext = await resolvedDeps.resolveAuthContext(req);
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 50);
    return jsonResponse(await resolvedDeps.search(authContext, q, limit));
  } catch (error) {
    if (error instanceof HttpErrorClass) return errorResponse(error.message, error.status, error.details);
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
