import type { AuthContext } from "./auth-types.ts";
import { HttpError } from "./responses.ts";

export interface RateLimitConfig {
  action: string;
  maxRequests: number;
  windowSeconds: number;
}

export interface OperationLogEntry {
  action: string;
  status: "success" | "error" | "rate_limited";
  authContext: AuthContext;
  actorKey?: string;
  resourceType?: string;
  resourceId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export function actorKeyForRequest(req: Request, authContext: AuthContext): string {
  if (authContext.tokenId) {
    return `token:${authContext.tokenId}`;
  }
  if (authContext.userId) {
    return `user:${authContext.userId}`;
  }

  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor) {
    return `ip:${forwardedFor}`;
  }

  const clientIp = req.headers.get("x-nf-client-connection-ip")?.trim();
  if (clientIp) {
    return `ip:${clientIp}`;
  }

  return "anonymous";
}

export async function enforceRateLimit(req: Request, authContext: AuthContext, config: RateLimitConfig): Promise<string> {
  const { createServiceClient } = await import("./supabase.ts");
  const service = createServiceClient();
  const actorKey = actorKeyForRequest(req, authContext);
  const windowStart = new Date(Date.now() - config.windowSeconds * 1000).toISOString();

  const { count, error } = await service
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("action", config.action)
    .eq("actor_key", actorKey)
    .gte("created_at", windowStart);

  if (error) {
    throw new HttpError(500, `Failed to evaluate rate limit for ${config.action}`, error.message);
  }

  if ((count ?? 0) >= config.maxRequests) {
    throw new HttpError(429, `Rate limit exceeded for ${config.action}`);
  }

  const { error: insertError } = await service.from("rate_limit_events").insert({
    action: config.action,
    actor_key: actorKey,
    actor_user_id: authContext.userId,
    metadata: {
      maxRequests: config.maxRequests,
      windowSeconds: config.windowSeconds,
    },
  });

  if (insertError) {
    throw new HttpError(500, `Failed to record rate limit event for ${config.action}`, insertError.message);
  }

  return actorKey;
}

export async function recordOperation(entry: OperationLogEntry): Promise<void> {
  const { createServiceClient } = await import("./supabase.ts");
  const service = createServiceClient();
  const { error } = await service.from("registry_operation_logs").insert({
    action: entry.action,
    status: entry.status,
    actor_key: entry.actorKey,
    actor_user_id: entry.authContext.userId,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId,
    message: entry.message,
    metadata: entry.metadata ?? {},
  });

  if (error) {
    console.error(`Failed to record registry operation log for ${entry.action}:`, error.message);
  }
}

export async function refreshDailyStats(namespaceId: string, occurredAtIso: string): Promise<void> {
  const { createServiceClient } = await import("./supabase.ts");
  const service = createServiceClient();
  const statDate = occurredAtIso.slice(0, 10);
  const { error } = await service.rpc("refresh_workflow_daily_stat", {
    p_namespace_id: namespaceId,
    p_stat_date: statDate,
  });

  if (error) {
    console.error(`Failed to refresh workflow daily stat for ${namespaceId}:`, error.message);
  }
}
