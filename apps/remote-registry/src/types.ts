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

export interface TokenSummary {
  tokenId: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  scopes: string[];
}

export interface RemoteProfile {
  userId: string;
  username: string | null;
  displayName: string | null;
  authMethod: string;
  scopes: string[];
}
