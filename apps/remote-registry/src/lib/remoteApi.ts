import { getSupabasePublishableKey, getSupabaseUrl } from "./env";
import type {
  CliTokenListResponse,
  ManagedWorkflow,
  PublishedWorkflowResponse,
  RemoteProfile,
  SearchResponse,
  TokenSummary,
  WorkflowAnalyticsResponse,
  WorkflowRunInsightsResponse,
  WorkflowDetail,
} from "../types";
import type { WorkflowDefinitionInput } from "./workflowSource";

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function httpStatusMessage(response: Response): string {
  return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
}

async function readFunctionPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) {
      const body = text.trim().slice(0, 500);
      throw new Error(body ? `${httpStatusMessage(response)}: ${body}` : httpStatusMessage(response));
    }
    throw new Error("Unexpected non-JSON response from server");
  }
}

async function callFunction<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getSupabaseUrl()}/functions/v1/${path}`, {
    ...init,
    headers: {
      apikey: getSupabasePublishableKey(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const payload = await readFunctionPayload(response);
  if (!response.ok) {
    const errorPayload = objectPayload(payload);
    const message =
      typeof errorPayload.error === "string"
        ? errorPayload.error
        : typeof errorPayload.message === "string"
          ? errorPayload.message
          : httpStatusMessage(response);
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

export function getWorkflow(owner: string, slug: string, accessToken?: string): Promise<WorkflowDetail> {
  const params = new URLSearchParams({ owner, slug });
  return callFunction<WorkflowDetail>(`pull-workflow?${params.toString()}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
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

export function listCliTokens(accessToken: string): Promise<CliTokenListResponse> {
  return callFunction<CliTokenListResponse>("list-cli-tokens", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function revokeCliToken(accessToken: string, tokenId: string): Promise<{ tokenId: string; revokedAt: string }> {
  return callFunction<{ tokenId: string; revokedAt: string }>("revoke-cli-token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ tokenId }),
  });
}

export function fetchWorkflowAnalytics(accessToken: string): Promise<WorkflowAnalyticsResponse> {
  return callFunction<WorkflowAnalyticsResponse>("workflow-analytics", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function refreshWorkflowAnalytics(accessToken: string, slug?: string): Promise<{ processed: number }> {
  const params = new URLSearchParams();
  if (slug) {
    params.set("slug", slug);
  }
  const query = params.toString();
  return callFunction<{ processed: number }>(`refresh-workflow-stats${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function fetchManagedWorkflow(accessToken: string, slug: string): Promise<ManagedWorkflow> {
  const params = new URLSearchParams({ slug });
  return callFunction<ManagedWorkflow>(`manage-workflow?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function updateManagedWorkflow(
  accessToken: string,
  body: { slug: string; title: string; description?: string | null; visibility: "public" | "private" }
): Promise<{ slug: string; title: string; description: string | null; visibility: string; updatedAt: string }> {
  return callFunction("manage-workflow", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
}

export function publishWorkflow(
  accessToken: string,
  body: {
    slug: string;
    title: string;
    description?: string | null;
    visibility: "public" | "private";
    versionLabel: string;
    sourceFormat: "markdown" | "json";
    rawSource: string;
    definition: WorkflowDefinitionInput;
    tags?: string[];
    changelog?: string | null;
    publishedState: "draft" | "published";
  }
): Promise<PublishedWorkflowResponse> {
  return callFunction<PublishedWorkflowResponse>("publish-workflow", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
}

export function fetchWorkflowRunInsights(accessToken: string): Promise<WorkflowRunInsightsResponse> {
  return callFunction<WorkflowRunInsightsResponse>("workflow-run-insights", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}
