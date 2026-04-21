import type { AuthContext } from "../_shared/auth-types.ts";
import { errorResponse, handleOptions, HttpError as HttpErrorClass, jsonResponse, readJsonBody, requireMethod } from "../_shared/responses.ts";

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

export interface CreateCliTokenDeps {
  resolveAuthContext: (req: Request) => Promise<AuthContext>;
  requireJwtAuth: (context: AuthContext) => Promise<AuthContext> | AuthContext;
  enforceRateLimit: (req: Request, context: AuthContext) => Promise<string>;
  recordOperation: (entry: {
    action: string;
    status: "success" | "error" | "rate_limited";
    authContext: AuthContext;
    actorKey?: string;
    resourceType?: string;
    resourceId?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  createToken: (req: Request, context: AuthContext, body: CreateCliTokenBody) => Promise<{
    token: string;
    tokenId: string;
    createdAt: string;
    expiresAt: string | null;
    scopes: string[];
  }>;
}

async function createToken(req: Request, context: AuthContext, body: CreateCliTokenBody) {
  const { sha256Hex } = await import("../_shared/auth.ts");
  const { createAnonClientWithAuth } = await import("../_shared/supabase.ts");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    throw new HttpErrorClass(400, "Token name is required");
  }

  const scopes = Array.isArray(body.scopes) && body.scopes.length > 0 ? body.scopes : ["workflow:read", "workflow:write"];
  if (scopes.some((scope) => !allowedScopes.has(scope))) {
    throw new HttpErrorClass(400, "Unsupported token scope provided");
  }

  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    throw new HttpErrorClass(400, "expiresAt must be a valid ISO timestamp");
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const client = createAnonClientWithAuth(req);
  const { data, error } = await client
    .from("cli_tokens")
    .insert({
      user_id: context.userId,
      name,
      token_hash: tokenHash,
      scopes,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
    })
    .select("id, created_at, expires_at, scopes")
    .single();

  if (error) {
    throw new HttpErrorClass(500, "Failed to create CLI token", error.message);
  }

  return {
    token,
    tokenId: data.id,
    createdAt: data.created_at,
    expiresAt: data.expires_at,
    scopes: data.scopes,
  };
}

export async function handleCreateCliToken(req: Request, deps?: Partial<CreateCliTokenDeps>): Promise<Response> {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const resolvedDeps: CreateCliTokenDeps = {
    resolveAuthContext: (req) => import("../_shared/auth.ts").then((mod) => mod.resolveAuthContext(req)),
    requireJwtAuth: (context) => import("../_shared/auth.ts").then((mod) => mod.requireJwtAuth(context as never) as AuthContext),
    enforceRateLimit: (req, context) => import("../_shared/ops.ts").then((mod) => mod.enforceRateLimit(req, context, { action: "create_cli_token", maxRequests: 5, windowSeconds: 3600 })),
    recordOperation: (entry) => import("../_shared/ops.ts").then((mod) => mod.recordOperation(entry)),
    createToken,
    ...deps,
  };

  let authContext: AuthContext | null = null;
  let actorKey: string | undefined;
  try {
    requireMethod(req, "POST");
    authContext = await resolvedDeps.requireJwtAuth(await resolvedDeps.resolveAuthContext(req));
    actorKey = await resolvedDeps.enforceRateLimit(req, authContext);
    const body = await readJsonBody<CreateCliTokenBody>(req);
    const created = await resolvedDeps.createToken(req, authContext, body);
    await resolvedDeps.recordOperation({
      action: "create_cli_token",
      status: "success",
      authContext,
      actorKey,
      resourceType: "cli_token",
      resourceId: created.tokenId,
      metadata: { scopes: created.scopes },
    });
    return jsonResponse(created, 201);
  } catch (error) {
    if (authContext) {
      await resolvedDeps.recordOperation({
        action: "create_cli_token",
        status: error instanceof HttpErrorClass && error.status === 429 ? "rate_limited" : "error",
        authContext,
        actorKey,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (error instanceof HttpErrorClass) {
      return errorResponse(error.message, error.status, error.details);
    }
    return errorResponse("Unexpected server error", 500, error instanceof Error ? error.message : String(error));
  }
}
