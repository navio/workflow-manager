import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, readJsonBody, requireMethod } from "../_shared/responses.ts";
import { normalizeOptionalString, normalizePublishedState, normalizeSourceFormat, normalizeString, normalizeTags, normalizeVisibility, validateWorkflowDefinition } from "../_shared/workflows.ts";

interface PublishWorkflowBody {
  slug?: string; title?: string; description?: string | null; visibility?: string; versionLabel?: string; sourceFormat?: string; rawSource?: string; definition?: unknown; tags?: string[]; changelog?: string | null; publishedState?: string;
}

export interface PublishWorkflowDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireAuth: (context: AuthContext, scope?: string) => Promise<AuthContext> | AuthContext;
  persistWorkflow: (userId: string, body: PublishWorkflowBody) => Promise<Record<string, unknown>>;
}

async function persistWorkflow(userId: string, body: PublishWorkflowBody): Promise<Record<string, unknown>> {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const slug = normalizeString(body.slug, "slug").toLowerCase();
  const title = normalizeString(body.title, "title");
  const versionLabel = normalizeString(body.versionLabel, "versionLabel");
  const rawSource = normalizeString(body.rawSource, "rawSource");
  const sourceFormat = normalizeSourceFormat(body.sourceFormat);
  const visibility = normalizeVisibility(body.visibility);
  const publishedState = normalizePublishedState(body.publishedState);
  const changelog = normalizeOptionalString(body.changelog);
  const description = normalizeOptionalString(body.description);
  const tags = normalizeTags(body.tags);
  const validationErrors = validateWorkflowDefinition(body.definition);
  if (validationErrors.length > 0) throw new HttpErrorClass(400, "Workflow definition failed validation", validationErrors);

  const service = createServiceClient();
  const { data: existingNamespace, error: namespaceLookupError } = await service.from("workflow_namespaces").select("id").eq("owner_user_id", userId).eq("slug", slug).maybeSingle();
  if (namespaceLookupError) throw new HttpErrorClass(500, "Failed to look up existing workflow namespace", namespaceLookupError.message);

  let namespaceId = existingNamespace?.id as string | undefined;
  if (!namespaceId) {
    const { data, error } = await service.from("workflow_namespaces").insert({ owner_user_id: userId, slug, title, description, visibility }).select("id").single();
    if (error) throw new HttpErrorClass(500, "Failed to create workflow namespace", error.message);
    namespaceId = data.id as string;
  } else {
    const { error } = await service.from("workflow_namespaces").update({ title, description, visibility, updated_at: new Date().toISOString() }).eq("id", namespaceId);
    if (error) throw new HttpErrorClass(500, "Failed to update workflow namespace", error.message);
  }

  const { data: version, error: versionError } = await service.from("workflow_versions").insert({ namespace_id: namespaceId, version_label: versionLabel, source_format: sourceFormat, raw_source: rawSource, definition_json: body.definition, changelog, published_state: publishedState, created_by_user_id: userId }).select("id, version_label, source_format, published_state, created_at").single();
  if (versionError) throw new HttpErrorClass(500, "Failed to create workflow version", versionError.message);

  if (tags.length > 0) {
    const { error: upsertError } = await service.from("workflow_tags").upsert(tags.map((name) => ({ name })), { onConflict: "name", ignoreDuplicates: false });
    if (upsertError) throw new HttpErrorClass(500, "Failed to upsert workflow tags", upsertError.message);
    const { data: tagRows, error: tagLookupError } = await service.from("workflow_tags").select("id, name").in("name", tags);
    if (tagLookupError) throw new HttpErrorClass(500, "Failed to load workflow tags", tagLookupError.message);
    const { error: joinError } = await service.from("workflow_version_tags").upsert((tagRows ?? []).map((tag) => ({ workflow_version_id: version.id, tag_id: tag.id })), { onConflict: "workflow_version_id,tag_id", ignoreDuplicates: true });
    if (joinError) throw new HttpErrorClass(500, "Failed to attach workflow tags", joinError.message);
  }

  const { error: namespaceUpdateError } = await service.from("workflow_namespaces").update({ latest_version_id: version.id, updated_at: new Date().toISOString() }).eq("id", namespaceId);
  if (namespaceUpdateError) throw new HttpErrorClass(500, "Failed to update latest workflow version", namespaceUpdateError.message);

  return { namespaceId, ownerUserId: userId, slug, title, visibility, version: version.version_label, sourceFormat: version.source_format, publishedState: version.published_state, createdAt: version.created_at, tags };
}

export async function handlePublishWorkflow(req: Request, deps?: Partial<PublishWorkflowDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  const resolvedDeps: PublishWorkflowDeps = {
    resolveAuthContext: (req) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(req)),
    requireAuth: (context, scope) => import("../_shared/auth.ts").then((mod) => mod.requireAuth(context as never, scope) as AuthContext),
    persistWorkflow,
    ...deps,
  };
  try {
    requireMethod(req, "POST");
    const authContext = await resolvedDeps.requireAuth(await resolvedDeps.resolveAuthContext(req), "workflow:write");
    const body = await readJsonBody<PublishWorkflowBody>(req);
    return jsonResponse(await resolvedDeps.persistWorkflow(authContext.userId!, body), 201);
  } catch (error) {
    if (error instanceof HttpErrorClass) return errorResponse(error.message, error.status, error.details);
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
