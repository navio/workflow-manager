import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleOptions, HttpError, jsonResponse, errorResponse, readJsonBody, requireMethod } from "../_shared/responses.ts";
import { requireAuth, resolveAuthContext } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

interface RevokeCliTokenBody {
  tokenId?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  try {
    requireMethod(req, "POST");
    const authContext = requireAuth(await resolveAuthContext(req), "workflow:write");
    const body = await readJsonBody<RevokeCliTokenBody>(req);
    const tokenId = typeof body.tokenId === "string" ? body.tokenId.trim() : "";
    if (!tokenId) {
      throw new HttpError(400, "tokenId is required");
    }

    const service = createServiceClient();
    const { data, error } = await service
      .from("cli_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", tokenId)
      .eq("user_id", authContext.userId)
      .is("revoked_at", null)
      .select("id, revoked_at")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Failed to revoke CLI token", error.message);
    }
    if (!data) {
      throw new HttpError(404, "CLI token not found");
    }

    return jsonResponse({ tokenId: data.id, revokedAt: data.revoked_at });
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status, error.details);
    }

    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
});
