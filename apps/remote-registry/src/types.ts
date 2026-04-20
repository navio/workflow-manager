export interface WorkflowSummary {
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

export interface SearchResponse {
  items: WorkflowSummary[];
  count: number;
  query: string;
}

export interface WorkflowDetail {
  owner: string;
  slug: string;
  title: string;
  description: string | null;
  visibility: string;
  version: string;
  sourceFormat: "markdown" | "json";
  rawSource: string;
  changelog: string | null;
  publishedState: string;
  createdAt: string;
}

export interface PublishedWorkflowResponse {
  namespaceId: string;
  ownerUserId: string;
  slug: string;
  title: string;
  visibility: string;
  version: string;
  sourceFormat: "markdown" | "json";
  publishedState: string;
  createdAt: string;
  tags: string[];
}

export interface TokenSummary {
  tokenId: string;
  token?: string;
  name?: string;
  createdAt: string;
  expiresAt: string | null;
  scopes: string[];
  revokedAt?: string | null;
  lastUsedAt?: string | null;
  active?: boolean;
}

export interface RemoteProfile {
  userId: string;
  username: string | null;
  displayName: string | null;
  authMethod: string;
  scopes: string[];
}

export interface WorkflowAnalyticsItem {
  slug: string;
  title: string;
  visibility: string;
  updatedAt: string;
  totalDownloads: number;
  lastDownloadedAt: string | null;
  dailyStats: Array<Record<string, unknown>>;
  downloadsByVersion: Array<{
    version: string;
    publishedState: string;
    createdAt: string;
    downloads: number;
  }>;
}

export interface WorkflowAnalyticsResponse {
  items: WorkflowAnalyticsItem[];
}

export interface CliTokenListResponse {
  items: TokenSummary[];
}
