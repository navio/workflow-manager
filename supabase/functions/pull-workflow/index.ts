import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleOptions, HttpError, jsonResponse, errorResponse, requireMethod } from "../_shared/responses.ts";
import { resolveAuthContext } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  try {
    requireMethod(req, "GET");
    const authContext = await resolveAuthContext(req);
    const url = new URL(req.url);
    const owner = url.searchParams.get("owner")?.trim().toLowerCase();
    const slug = url.searchParams.get("slug")?.trim().toLowerCase();
    const versionLabel = url.searchParams.get("version")?.trim();

    if (!owner || !slug) {
      throw new HttpError(400, "owner and slug query parameters are required");
    }

    const service = createServiceClient();
    const { data: ownerProfile, error: ownerError } = await service
      .from("profiles")
      .select("id, username")
      .eq("username", owner)
      .maybeSingle();
    if (ownerError) {
      throw new HttpError(500, "Failed to resolve workflow owner", ownerError.message);
    }
    if (!ownerProfile) {
      throw new HttpError(404, "Workflow owner not found");
    }

    const { data: namespace, error: namespaceError } = await service
      .from("workflow_namespaces")
      .select("id, owner_user_id, slug, title, description, visibility, latest_version_id")
      .eq("owner_user_id", ownerProfile.id)
      .eq("slug", slug)
      .maybeSingle();
    if (namespaceError) {
      throw new HttpError(500, "Failed to load workflow namespace", namespaceError.message);
    }
    if (!namespace) {
      throw new HttpError(404, "Workflow not found");
    }

    const isOwner = authContext.userId === namespace.owner_user_id;
    let versionQuery = service
      .from("workflow_versions")
      .select("id, version_label, source_format, raw_source, definition_json, changelog, published_state, created_at")
      .eq("namespace_id", namespace.id);

    if (versionLabel) {
      versionQuery = versionQuery.eq("version_label", versionLabel);
    } else if (isOwner && namespace.latest_version_id) {
      versionQuery = versionQuery.eq("id", namespace.latest_version_id);
    } else {
      versionQuery = versionQuery.eq("published_state", "published").order("created_at", { ascending: false }).limit(1);
    }

    const { data: versionRows, error: versionError } = await versionQuery;
    if (versionError) {
      throw new HttpError(500, "Failed to load workflow version", versionError.message);
    }
    const version = Array.isArray(versionRows) ? versionRows[0] : versionRows;
    if (!version) {
      throw new HttpError(404, "Workflow version not found");
    }

    const isPublicReadable = namespace.visibility === "public" && version.published_state === "published";
    if (!isOwner && !isPublicReadable) {
      throw new HttpError(404, "Workflow not found");
    }

    const channel = authContext.method === "cli_token" ? "cli" : authContext.method === "jwt" ? "web" : "api";
    await service.from("workflow_download_events").insert({
      namespace_id: namespace.id,
      version_id: version.id,
      actor_user_id: authContext.userId,
      channel,
      client_version: req.headers.get("X-Workflow-Manager-Version"),
    });

    return jsonResponse({
      owner,
      slug: namespace.slug,
      title: namespace.title,
      description: namespace.description,
      visibility: isOwner ? namespace.visibility : "public",
      version: version.version_label,
      sourceFormat: version.source_format,
      rawSource: version.raw_source,
      definition: version.definition_json,
      changelog: version.changelog,
      publishedState: version.published_state,
      createdAt: version.created_at,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status, error.details);
    }

    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
});
