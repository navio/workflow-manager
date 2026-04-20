import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, readJsonBody, requireMethod } from "../_shared/responses.ts";

interface RevokeCliTokenBody {
  tokenId?: string;
}

export interface RevokeCliTokenDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireAuth: (context: AuthContext, scope?: string) => Promise<AuthContext> | AuthContext;
  revokeToken: (userId: string, tokenId: string) => Promise<{ tokenId: string; revokedAt: string }>;
}

async function revokeToken(userId: string, tokenId: string) {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  const { data, error } = await service
    .from("cli_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id, revoked_at")
    .maybeSingle();

  if (error) throw new HttpErrorClass(500, "Failed to revoke CLI token", error.message);
  if (!data) throw new HttpErrorClass(404, "CLI token not found");
  return { tokenId: data.id, revokedAt: data.revoked_at };
}

export async function handleRevokeCliToken(req: Request, deps?: Partial<RevokeCliTokenDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const resolvedDeps: RevokeCliTokenDeps = {
    resolveAuthContext: (req) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(req)),
    requireAuth: (context, scope) => import("../_shared/auth.ts").then((mod) => mod.requireAuth(context as never, scope) as AuthContext),
    revokeToken,
    ...deps,
  };

  try {
    requireMethod(req, "POST");
    const authContext = await resolvedDeps.requireAuth(await resolvedDeps.resolveAuthContext(req), "workflow:write");
    const body = await readJsonBody<RevokeCliTokenBody>(req);
    const tokenId = typeof body.tokenId === "string" ? body.tokenId.trim() : "";
    if (!tokenId) throw new HttpErrorClass(400, "tokenId is required");
    return jsonResponse(await resolvedDeps.revokeToken(authContext.userId!, tokenId));
  } catch (error) {
    if (error instanceof HttpErrorClass) {
      return errorResponse(error.message, error.status, error.details);
    }
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
