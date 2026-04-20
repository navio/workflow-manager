import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, requireMethod } from "../_shared/responses.ts";

export interface PullWorkflowDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  pullWorkflow: (req: Request, authContext: AuthContext, owner: string, slug: string, versionLabel?: string) => Promise<Record<string, unknown>>;
}

async function pullWorkflow(req: Request, authContext: AuthContext, owner: string, slug: string, versionLabel?: string) {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  const { data: ownerProfile, error: ownerError } = await service.from("profiles").select("id, username").eq("username", owner).maybeSingle();
  if (ownerError) throw new HttpErrorClass(500, "Failed to resolve workflow owner", ownerError.message);
  if (!ownerProfile) throw new HttpErrorClass(404, "Workflow owner not found");
  const { data: namespace, error: namespaceError } = await service.from("workflow_namespaces").select("id, owner_user_id, slug, title, description, visibility, latest_version_id").eq("owner_user_id", ownerProfile.id).eq("slug", slug).maybeSingle();
  if (namespaceError) throw new HttpErrorClass(500, "Failed to load workflow namespace", namespaceError.message);
  if (!namespace) throw new HttpErrorClass(404, "Workflow not found");
  const isOwner = authContext.userId === namespace.owner_user_id;
  let versionQuery = service.from("workflow_versions").select("id, version_label, source_format, raw_source, definition_json, changelog, published_state, created_at").eq("namespace_id", namespace.id);
  if (versionLabel) versionQuery = versionQuery.eq("version_label", versionLabel);
  else if (isOwner && namespace.latest_version_id) versionQuery = versionQuery.eq("id", namespace.latest_version_id);
  else versionQuery = versionQuery.eq("published_state", "published").order("created_at", { ascending: false }).limit(1);
  const { data: versionRows, error: versionError } = await versionQuery;
  if (versionError) throw new HttpErrorClass(500, "Failed to load workflow version", versionError.message);
  const version = Array.isArray(versionRows) ? versionRows[0] : versionRows;
  if (!version) throw new HttpErrorClass(404, "Workflow version not found");
  const isPublicReadable = namespace.visibility === "public" && version.published_state === "published";
  if (!isOwner && !isPublicReadable) throw new HttpErrorClass(404, "Workflow not found");
  const channel = authContext.method === "cli_token" ? "cli" : authContext.method === "jwt" ? "web" : "api";
  await service.from("workflow_download_events").insert({ namespace_id: namespace.id, version_id: version.id, actor_user_id: authContext.userId, channel, client_version: req.headers.get("X-Workflow-Manager-Version") });
  return { owner, slug: namespace.slug, title: namespace.title, description: namespace.description, visibility: isOwner ? namespace.visibility : "public", version: version.version_label, sourceFormat: version.source_format, rawSource: version.raw_source, definition: version.definition_json, changelog: version.changelog, publishedState: version.published_state, createdAt: version.created_at };
}

export async function handlePullWorkflow(req: Request, deps?: Partial<PullWorkflowDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  const resolvedDeps: PullWorkflowDeps = { resolveAuthContext: (req) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(req)), pullWorkflow, ...deps };
  try {
    requireMethod(req, "GET");
    const authContext = await resolvedDeps.resolveAuthContext(req);
    const url = new URL(req.url);
    const owner = url.searchParams.get("owner")?.trim().toLowerCase();
    const slug = url.searchParams.get("slug")?.trim().toLowerCase();
    const versionLabel = url.searchParams.get("version")?.trim();
    if (!owner || !slug) throw new HttpErrorClass(400, "owner and slug query parameters are required");
    return jsonResponse(await resolvedDeps.pullWorkflow(req, authContext, owner, slug, versionLabel));
  } catch (error) {
    if (error instanceof HttpErrorClass) return errorResponse(error.message, error.status, error.details);
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
