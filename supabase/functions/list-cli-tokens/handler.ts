import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, requireMethod } from "../_shared/responses.ts";

export interface ListCliTokensDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireAuth: (context: AuthContext, scope?: string) => Promise<AuthContext> | AuthContext;
  listTokens: (userId: string) => Promise<{ items: Record<string, unknown>[] }>;
}

async function listTokens(userId: string): Promise<{ items: Record<string, unknown>[] }> {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  const { data, error } = await service
    .from("cli_tokens")
    .select("id, name, scopes, created_at, expires_at, revoked_at, last_used_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new HttpErrorClass(500, "Failed to load CLI tokens", error.message);
  }

  return {
    items: (data ?? []).map((token) => ({
      tokenId: token.id,
      name: token.name,
      scopes: token.scopes,
      createdAt: token.created_at,
      expiresAt: token.expires_at,
      revokedAt: token.revoked_at,
      lastUsedAt: token.last_used_at,
      active: !token.revoked_at,
    })),
  };
}

export async function handleListCliTokens(req: Request, deps?: Partial<ListCliTokensDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const resolvedDeps: ListCliTokensDeps = {
    resolveAuthContext: (request) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(request)),
    requireAuth: (context, scope) => import("../_shared/auth.ts").then((mod) => mod.requireAuth(context as never, scope) as AuthContext),
    listTokens,
    ...deps,
  };

  try {
    requireMethod(req, "GET");
    const authContext = await resolvedDeps.requireAuth(await resolvedDeps.resolveAuthContext(req), "workflow:read");
    return jsonResponse(await resolvedDeps.listTokens(authContext.userId!));
  } catch (error) {
    if (error instanceof HttpErrorClass) {
      return errorResponse(error.message, error.status, error.details);
    }

    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
