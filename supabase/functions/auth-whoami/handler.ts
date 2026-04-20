import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, requireMethod } from "../_shared/responses.ts";

export interface AuthWhoAmIDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireAuth: (context: AuthContext, scope?: string) => Promise<AuthContext> | AuthContext;
  getProfile: (userId: string) => Promise<{ username: string | null; displayName: string | null }>;
}

async function getProfile(userId: string) {
  const { createServiceClient } = await import("../_shared/supabase.ts");
  const service = createServiceClient();
  const { data, error } = await service.from("profiles").select("username, display_name").eq("id", userId).maybeSingle();
  if (error) throw new HttpErrorClass(500, "Failed to load current profile", error.message);
  return { username: data?.username ?? null, displayName: data?.display_name ?? null };
}

export async function handleAuthWhoAmI(req: Request, deps?: Partial<AuthWhoAmIDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const resolvedDeps: AuthWhoAmIDeps = {
    resolveAuthContext: (req) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(req)),
    requireAuth: (context, scope) => import("../_shared/auth.ts").then((mod) => mod.requireAuth(context as never, scope) as AuthContext),
    getProfile,
    ...deps,
  };

  try {
    requireMethod(req, "GET");
    const authContext = await resolvedDeps.requireAuth(await resolvedDeps.resolveAuthContext(req));
    const profile = await resolvedDeps.getProfile(authContext.userId!);
    return jsonResponse({ userId: authContext.userId, username: profile.username, displayName: profile.displayName, authMethod: authContext.method, scopes: authContext.scopes });
  } catch (error) {
    if (error instanceof HttpErrorClass) {
      return errorResponse(error.message, error.status, error.details);
    }
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
