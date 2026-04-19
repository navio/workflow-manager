import type { User } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./responses.ts";
import { createAnonClientWithAuth, createServiceClient } from "./supabase.ts";

export type AuthMethod = "anonymous" | "jwt" | "cli_token";

export interface AuthContext {
  method: AuthMethod;
  userId: string | null;
  scopes: string[];
  tokenId?: string;
  user?: User;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return null;
  }

  const [scheme, value] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) {
    throw new HttpError(401, "Expected Authorization: Bearer <token>");
  }

  return value;
}

export async function sha256Hex(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveJwtAuth(req: Request): Promise<AuthContext | null> {
  try {
    const client = createAnonClientWithAuth(req);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) {
      return null;
    }

    return {
      method: "jwt",
      userId: data.user.id,
      scopes: ["workflow:read", "workflow:write"],
      user: data.user,
    };
  } catch {
    return null;
  }
}

async function resolveCliTokenAuth(token: string): Promise<AuthContext | null> {
  const service = createServiceClient();
  const tokenHash = await sha256Hex(token);
  const { data, error } = await service
    .from("cli_tokens")
    .select("id, user_id, scopes, revoked_at, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data || data.revoked_at) {
    return null;
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return null;
  }

  await service.from("cli_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);

  return {
    method: "cli_token",
    userId: data.user_id,
    scopes: Array.isArray(data.scopes) ? data.scopes : [],
    tokenId: data.id,
  };
}

export async function resolveAuthContext(req: Request): Promise<AuthContext> {
  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    return { method: "anonymous", userId: null, scopes: [] };
  }

  const jwtAuth = await resolveJwtAuth(req);
  if (jwtAuth) {
    return jwtAuth;
  }

  const cliTokenAuth = await resolveCliTokenAuth(bearerToken);
  if (cliTokenAuth) {
    return cliTokenAuth;
  }

  throw new HttpError(401, "Invalid or expired authentication token");
}

export function requireAuth(context: AuthContext, scope?: string): AuthContext {
  if (!context.userId) {
    throw new HttpError(401, "Authentication is required");
  }

  if (scope && !context.scopes.includes(scope)) {
    throw new HttpError(403, `Missing required scope: ${scope}`);
  }

  return context;
}

export function requireJwtAuth(context: AuthContext): AuthContext {
  if (context.method !== "jwt" || !context.userId) {
    throw new HttpError(401, "A signed-in web session is required");
  }

  return context;
}
