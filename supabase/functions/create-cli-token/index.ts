import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleOptions, HttpError, jsonResponse, errorResponse, readJsonBody, requireMethod } from "../_shared/responses.ts";
import { requireJwtAuth, resolveAuthContext, sha256Hex } from "../_shared/auth.ts";
import { createAnonClientWithAuth } from "../_shared/supabase.ts";

interface CreateCliTokenBody {
  name?: string;
  scopes?: string[];
  expiresAt?: string | null;
}

const allowedScopes = new Set(["workflow:read", "workflow:write"]);

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `wm_${secret}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  try {
    requireMethod(req, "POST");

    const authContext = requireJwtAuth(await resolveAuthContext(req));
    const body = await readJsonBody<CreateCliTokenBody>(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      throw new HttpError(400, "Token name is required");
    }

    const scopes = Array.isArray(body.scopes) && body.scopes.length > 0 ? body.scopes : ["workflow:read", "workflow:write"];
    if (scopes.some((scope) => !allowedScopes.has(scope))) {
      throw new HttpError(400, "Unsupported token scope provided");
    }

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new HttpError(400, "expiresAt must be a valid ISO timestamp");
    }

    const plainToken = randomToken();
    const tokenHash = await sha256Hex(plainToken);
    const client = createAnonClientWithAuth(req);
    const { data, error } = await client
      .from("cli_tokens")
      .insert({
        user_id: authContext.userId,
        name,
        token_hash: tokenHash,
        scopes,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
      })
      .select("id, created_at, expires_at, scopes")
      .single();

    if (error) {
      throw new HttpError(500, "Failed to create CLI token", error.message);
    }

    return jsonResponse({
      token: plainToken,
      tokenId: data.id,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      scopes: data.scopes,
    }, 201);
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status, error.details);
    }

    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
});
