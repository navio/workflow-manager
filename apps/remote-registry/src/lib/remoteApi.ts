import { getSupabasePublishableKey, getSupabaseUrl } from "./env";
import type { RemoteProfile, SearchResponse, TokenSummary, WorkflowDetail } from "../types";

async function callFunction<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getSupabaseUrl()}/functions/v1/${path}`, {
    ...init,
    headers: {
      apikey: getSupabasePublishableKey(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : typeof payload.message === "string" ? payload.message : "Remote request failed";
    throw new Error(message);
  }

  return payload as T;
}

export function searchWorkflows(query: string): Promise<SearchResponse> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  return callFunction<SearchResponse>(`search-workflows?${params.toString()}`);
}

export function getWorkflow(owner: string, slug: string): Promise<WorkflowDetail> {
  const params = new URLSearchParams({ owner, slug });
  return callFunction<WorkflowDetail>(`pull-workflow?${params.toString()}`);
}

export function createCliToken(accessToken: string, name: string): Promise<TokenSummary> {
  return callFunction<TokenSummary>("create-cli-token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name }),
  });
}

export function fetchWhoAmI(accessToken: string): Promise<RemoteProfile> {
  return callFunction<RemoteProfile>("auth-whoami", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}
