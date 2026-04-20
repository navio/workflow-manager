import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, readJsonBody, requireMethod } from "../_shared/responses.ts";

interface UpdateWorkflowBody {
  slug?: string;
  title?: string;
  description?: string | null;
  visibility?: string;
}

export interface ManageWorkflowDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireAuth: (context: AuthContext, scope?: string) => Promise<AuthContext> | AuthContext;
  getWorkflow: (userId: string, slug: string) => Promise<Record<string, unknown>>;
  updateWorkflow: (userId: string, body: UpdateWorkflowBody) => Promise<Record<string, unknown>>;
}

function normalizeVisibility(value: unknown): "public" | "private" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "private";
  if (normalized !== "public" && normalized !== "private") {
    throw new HttpErrorClass(400, "visibility must be 'public' or 'private'");
  }
  return normalized;
}

async function getWorkflow(userId: string, slug: string): Promise<Record<string, unknown>> {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();

  const { data: namespace, error: namespaceError } = await service
    .from("workflow_namespaces")
    .select("id, slug, title, description, visibility, latest_version_id, updated_at, created_at")
    .eq("owner_user_id", userId)
    .eq("slug", slug)
    .maybeSingle();

  if (namespaceError) throw new HttpErrorClass(500, "Failed to load workflow namespace", namespaceError.message);
  if (!namespace) throw new HttpErrorClass(404, "Workflow not found");

  const { data: versions, error: versionsError } = await service
    .from("workflow_versions")
    .select("id, version_label, source_format, raw_source, changelog, published_state, created_at")
    .eq("namespace_id", namespace.id)
    .order("created_at", { ascending: false });
  if (versionsError) throw new HttpErrorClass(500, "Failed to load workflow versions", versionsError.message);

  const latestVersionIds = namespace.latest_version_id ? [namespace.latest_version_id] : [];
  const { data: tagLinks, error: tagLinksError } = latestVersionIds.length
    ? await service.from("workflow_version_tags").select("workflow_version_id, tag_id").in("workflow_version_id", latestVersionIds)
    : { data: [], error: null };
  if (tagLinksError) throw new HttpErrorClass(500, "Failed to load workflow tag links", tagLinksError.message);

  const tagIds = [...new Set((tagLinks ?? []).map((item) => item.tag_id))];
  const { data: tags, error: tagsError } = tagIds.length
    ? await service.from("workflow_tags").select("id, name").in("id", tagIds)
    : { data: [], error: null };
  if (tagsError) throw new HttpErrorClass(500, "Failed to load workflow tags", tagsError.message);

  const tagById = new Map((tags ?? []).map((tag) => [tag.id, tag.name]));
  const latestTags = (tagLinks ?? []).map((item) => tagById.get(item.tag_id)).filter(Boolean);

  return {
    slug: namespace.slug,
    title: namespace.title,
    description: namespace.description,
    visibility: namespace.visibility,
    latestVersionId: namespace.latest_version_id,
    updatedAt: namespace.updated_at,
    createdAt: namespace.created_at,
    latestTags,
    versions: (versions ?? []).map((version) => ({
      id: version.id,
      version: version.version_label,
      sourceFormat: version.source_format,
      rawSource: version.raw_source,
      changelog: version.changelog,
      publishedState: version.published_state,
      createdAt: version.created_at,
      isLatest: version.id === namespace.latest_version_id,
    })),
  };
}

async function updateWorkflow(userId: string, body: UpdateWorkflowBody): Promise<Record<string, unknown>> {
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!slug || !title) {
    throw new HttpErrorClass(400, "slug and title are required");
  }

  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  const updates = {
    title,
    description: typeof body.description === "string" ? body.description.trim() : null,
    visibility: normalizeVisibility(body.visibility),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await service
    .from("workflow_namespaces")
    .update(updates)
    .eq("owner_user_id", userId)
    .eq("slug", slug)
    .select("slug, title, description, visibility, updated_at")
    .maybeSingle();
  if (error) throw new HttpErrorClass(500, "Failed to update workflow namespace", error.message);
  if (!data) throw new HttpErrorClass(404, "Workflow not found");
  return {
    slug: data.slug,
    title: data.title,
    description: data.description,
    visibility: data.visibility,
    updatedAt: data.updated_at,
  };
}

export async function handleManageWorkflow(req: Request, deps?: Partial<ManageWorkflowDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const resolvedDeps: ManageWorkflowDeps = {
    resolveAuthContext: (request) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(request)),
    requireAuth: (context, scope) => import("../_shared/auth.ts").then((mod) => mod.requireAuth(context as never, scope) as AuthContext),
    getWorkflow,
    updateWorkflow,
    ...deps,
  };

  try {
    const authContext = await resolvedDeps.requireAuth(await resolvedDeps.resolveAuthContext(req), "workflow:write");
    if (req.method === "GET") {
      const slug = new URL(req.url).searchParams.get("slug")?.trim().toLowerCase();
      if (!slug) throw new HttpErrorClass(400, "slug query parameter is required");
      return jsonResponse(await resolvedDeps.getWorkflow(authContext.userId!, slug));
    }

    requireMethod(req, "POST");
    const body = await readJsonBody<UpdateWorkflowBody>(req);
    return jsonResponse(await resolvedDeps.updateWorkflow(authContext.userId!, body));
  } catch (error) {
    if (error instanceof HttpErrorClass) return errorResponse(error.message, error.status, error.details);
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
