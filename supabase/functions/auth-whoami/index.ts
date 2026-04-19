import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleOptions, HttpError, jsonResponse, errorResponse, requireMethod } from "../_shared/responses.ts";
import { requireAuth, resolveAuthContext } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  try {
    requireMethod(req, "GET");
    const authContext = requireAuth(await resolveAuthContext(req));
    const service = createServiceClient();
    const { data: profile, error } = await service
      .from("profiles")
      .select("username, display_name")
      .eq("id", authContext.userId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Failed to load current profile", error.message);
    }

    return jsonResponse({
      userId: authContext.userId,
      username: profile?.username ?? null,
      displayName: profile?.display_name ?? null,
      authMethod: authContext.method,
      scopes: authContext.scopes,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status, error.details);
    }

    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
});
