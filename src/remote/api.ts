import type { WorkflowDefinition } from "../types.js";
import { resolveAuthToken } from "./config.js";

const DEFAULT_REMOTE_URL = "https://whairnylpdvxxgbygbzu.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_t5VATQUjIOtHrtK3wFi5Cw_Q088yz0Z";

export interface RemoteSearchResultItem {
  owner: string;
  ownerDisplayName: string | null;
  slug: string;
  title: string;
  description: string | null;
  visibility: string;
  latestVersion: string | null;
  sourceFormat: string | null;
  publishedState: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface WhoAmIResponse {
  userId: string;
  username: string | null;
  displayName: string | null;
  authMethod: string;
  scopes: string[];
}

export interface PublishRequest {
  slug: string;
  title: string;
  description?: string | null;
  visibility: "public" | "private";
  versionLabel: string;
  sourceFormat: "markdown" | "json";
  rawSource: string;
  definition: WorkflowDefinition;
  tags?: string[];
  changelog?: string | null;
  publishedState: "draft" | "published";
}

export interface PullResponse {
  owner: string;
  slug: string;
  title: string;
  description: string | null;
  visibility: string;
  version: string;
  sourceFormat: "markdown" | "json";
  rawSource: string;
  definition: WorkflowDefinition;
  changelog: string | null;
  publishedState: string;
  createdAt: string;
}

function remoteBaseUrl(): string {
  return process.env.WORKFLOW_MANAGER_REMOTE_URL ?? DEFAULT_REMOTE_URL;
}

function publishableKey(): string {
  return process.env.WORKFLOW_MANAGER_REMOTE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY;
}

function buildHeaders(body?: unknown, token?: string): HeadersInit {
  const headers: Record<string, string> = {
    apikey: publishableKey(),
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function remoteFetch<T>(path: string, init: RequestInit = {}, requireAuth = false): Promise<T> {
  const token = resolveAuthToken();
  if (requireAuth && !token) {
    throw new Error("Not authenticated. Run `workflow-manager auth login --token <token>` first.");
  }

  const res = await fetch(`${remoteBaseUrl()}/functions/v1/${path}`, {
    ...init,
    headers: {
      ...buildHeaders(init.body, token),
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : `Remote request failed with status ${res.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function fetchWhoAmI(): Promise<WhoAmIResponse> {
  return remoteFetch<WhoAmIResponse>("auth-whoami", { method: "GET" }, true);
}

export async function searchRemoteWorkflows(query: string): Promise<{ items: RemoteSearchResultItem[]; count: number; query: string }> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  return remoteFetch(`search-workflows?${params.toString()}`, { method: "GET" });
}

export async function publishRemoteWorkflow(request: PublishRequest): Promise<Record<string, unknown>> {
  return remoteFetch<Record<string, unknown>>(
    "publish-workflow",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    true
  );
}

export async function pullRemoteWorkflow(owner: string, slug: string, version?: string): Promise<PullResponse> {
  const params = new URLSearchParams({ owner, slug });
  if (version) {
    params.set("version", version);
  }
  return remoteFetch<PullResponse>(`pull-workflow?${params.toString()}`, { method: "GET" });
}
