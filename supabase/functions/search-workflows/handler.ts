import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, requireMethod } from "../_shared/responses.ts";

interface NamespaceRow {
  id: string;
  owner_user_id: string;
  slug: string;
  title: string;
  description: string | null;
  visibility: "public" | "private";
  latest_version_id: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  namespace_id: string;
  version_label: string;
  source_format: string;
  published_state: "draft" | "published";
  created_at: string;
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
}

interface TagLinkRow {
  workflow_version_id: string;
  tag_id: number;
}

interface TagRow {
  id: number;
  name: string;
}

interface SearchWorkflowItem {
  owner: string;
  ownerDisplayName: string | null;
  slug: string;
  title: string;
  description: string | null;
  visibility: string;
  latestVersion: string | null;
  sourceFormat: string | null;
  publishedState: string | null;
  tags: string[];
  updatedAt: string;
  createdAt: string;
}

export interface SearchWorkflowsDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  search: (authContext: AuthContext, query: string, limit: number) => Promise<{ items: Record<string, unknown>[]; count: number; query: string }>;
}

function isInvalidAuthTokenError(error: unknown): error is HttpErrorClass {
  return error instanceof HttpErrorClass && error.status === 401 && error.message === "Invalid or expired authentication token";
}

export function selectVisibleVersion(
  versions: VersionRow[],
  latestVersionId: string | null,
  isOwner: boolean
): VersionRow | null {
  if (isOwner && latestVersionId) {
    return versions.find((version) => version.id === latestVersionId) ?? null;
  }

  if (isOwner) {
    return versions[0] ?? null;
  }

  return versions.find((version) => version.published_state === "published") ?? null;
}

export function matchesSearchQuery(item: SearchWorkflowItem, loweredQuery: string): boolean {
  if (!loweredQuery) {
    return true;
  }

  return [item.slug, item.title, item.description ?? "", item.owner, item.ownerDisplayName ?? "", ...item.tags]
    .join(" ")
    .toLowerCase()
    .includes(loweredQuery);
}

async function search(authContext: AuthContext, q: string, limit: number) {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  let query = service
    .from("workflow_namespaces")
    .select("id, owner_user_id, slug, title, description, visibility, latest_version_id, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (authContext.userId) query = query.or(`visibility.eq.public,owner_user_id.eq.${authContext.userId}`);
  else query = query.eq("visibility", "public");
  const { data: namespaces, error: namespaceError } = await query;
  if (namespaceError) throw new HttpErrorClass(500, "Failed to search workflows", namespaceError.message);
  const namespaceRows = (namespaces ?? []) as NamespaceRow[];
  const ownerIds = [...new Set(namespaceRows.map((row) => row.owner_user_id))];
  const namespaceIds = [...new Set(namespaceRows.map((row) => row.id))];
  const [{ data: profiles, error: profilesError }, { data: versions, error: versionsError }] = await Promise.all([
    ownerIds.length > 0
      ? service.from("profiles").select("id, username, display_name").in("id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    namespaceIds.length > 0
      ? service
          .from("workflow_versions")
          .select("id, namespace_id, version_label, source_format, published_state, created_at")
          .in("namespace_id", namespaceIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesError) throw new HttpErrorClass(500, "Failed to load workflow owners", profilesError.message);
  if (versionsError) throw new HttpErrorClass(500, "Failed to load workflow versions", versionsError.message);

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile as ProfileRow]));
  const versionsByNamespaceId = new Map<string, VersionRow[]>();
  for (const version of (versions ?? []) as VersionRow[]) {
    const namespaceVersions = versionsByNamespaceId.get(version.namespace_id);
    if (namespaceVersions) {
      namespaceVersions.push(version);
    } else {
      versionsByNamespaceId.set(version.namespace_id, [version]);
    }
  }

  const selectedVersions = namespaceRows
    .map((namespace) => {
      const isOwner = authContext.userId === namespace.owner_user_id;
      return selectVisibleVersion(versionsByNamespaceId.get(namespace.id) ?? [], namespace.latest_version_id, isOwner);
    })
    .filter(Boolean) as VersionRow[];
  const selectedVersionIds = [...new Set(selectedVersions.map((version) => version.id))];
  const { data: tagLinks, error: tagLinksError } = selectedVersionIds.length
    ? await service.from("workflow_version_tags").select("workflow_version_id, tag_id").in("workflow_version_id", selectedVersionIds)
    : { data: [], error: null };
  if (tagLinksError) throw new HttpErrorClass(500, "Failed to load workflow tag links", tagLinksError.message);

  const tagIds = [...new Set((tagLinks ?? []).map((link) => link.tag_id))];
  const { data: tags, error: tagsError } = tagIds.length
    ? await service.from("workflow_tags").select("id, name").in("id", tagIds)
    : { data: [], error: null };
  if (tagsError) throw new HttpErrorClass(500, "Failed to load workflow tags", tagsError.message);

  const tagNameById = new Map((tags ?? []).map((tag) => [(tag as TagRow).id, (tag as TagRow).name]));
  const tagsByVersionId = new Map<string, string[]>();
  for (const link of (tagLinks ?? []) as TagLinkRow[]) {
    const tagName = tagNameById.get(link.tag_id);
    if (!tagName) {
      continue;
    }
    const versionTags = tagsByVersionId.get(link.workflow_version_id);
    if (versionTags) {
      versionTags.push(tagName);
    } else {
      tagsByVersionId.set(link.workflow_version_id, [tagName]);
    }
  }

  const loweredQuery = q.toLowerCase();
  const items = namespaceRows.map((namespace) => {
    const isOwner = authContext.userId === namespace.owner_user_id;
    const version = selectVisibleVersion(versionsByNamespaceId.get(namespace.id) ?? [], namespace.latest_version_id, isOwner);
    if (!version) return null;
    const isPublicReadable = namespace.visibility === "public" && version?.published_state === "published";
    if (!isOwner && !isPublicReadable) return null;
    const ownerProfile = profileById.get(namespace.owner_user_id);
    return {
      owner: ownerProfile?.username ?? namespace.owner_user_id,
      ownerDisplayName: ownerProfile?.display_name ?? null,
      slug: namespace.slug,
      title: namespace.title,
      description: namespace.description,
      visibility: isOwner ? namespace.visibility : "public",
      latestVersion: version.version_label,
      sourceFormat: version.source_format,
      publishedState: version.published_state,
      tags: tagsByVersionId.get(version.id) ?? [],
      updatedAt: namespace.updated_at,
      createdAt: namespace.created_at,
    } satisfies SearchWorkflowItem;
  }).filter((item) => {
    if (!item) return false;
    return matchesSearchQuery(item, loweredQuery);
  }).filter(Boolean) as Record<string, unknown>[];
  return { items, count: items.length, query: q };
}

export async function handleSearchWorkflows(req: Request, deps?: Partial<SearchWorkflowsDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  const resolvedDeps: SearchWorkflowsDeps = { resolveAuthContext: (req) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(req)), search, ...deps };
  try {
    requireMethod(req, "GET");
    let authContext: AuthContext;
    try {
      authContext = await resolvedDeps.resolveAuthContext(req);
    } catch (error) {
      if (!isInvalidAuthTokenError(error)) {
        throw error;
      }
      authContext = { method: "anonymous", userId: null, scopes: [] };
    }
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 50);
    return jsonResponse(await resolvedDeps.search(authContext, q, limit));
  } catch (error) {
    if (error instanceof HttpErrorClass) return errorResponse(error.message, error.status, error.details);
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
