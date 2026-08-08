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
  tags: string[];
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

export interface ManagedWorkflowVersion {
  id: string;
  version: string;
  sourceFormat: "markdown" | "json";
  rawSource: string;
  changelog: string | null;
  publishedState: string;
  createdAt: string;
  isLatest: boolean;
}

export interface ManagedWorkflow {
  slug: string;
  title: string;
  description: string | null;
  visibility: string;
  latestVersionId: string | null;
  updatedAt: string;
  createdAt: string;
  latestTags: string[];
  versions: ManagedWorkflowVersion[];
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

export interface WorkflowRunInsight {
  workflowKey: string;
  workflowTitle: string | null;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  approvalRuns: number;
  successRate: number;
  averageEffectiveness: number;
  averageDurationMs: number;
  lastRunAt: string | null;
  latestRun: Record<string, unknown> | null;
  recentRuns: Array<Record<string, unknown>>;
}

export interface WorkflowRunInsightsResponse {
  items: WorkflowRunInsight[];
}

export interface ObservabilityAggregateWindow {
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  waitingRuns: number;
  cancelledRuns: number;
  retriedRuns: number;
  successRate: number;
  averageDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
}

export interface ObservabilityCommunityWindow extends ObservabilityAggregateWindow {
  distinctUsers: number | null;
  suppressed: boolean;
  minimumCohort: 5;
}

export interface ObservabilityRuntimeBreakdownEntry {
  // Null exactly when suppressed — the API never returns a below-threshold segment's
  // adapter/model label, even with metrics zeroed, so this must not be rendered as if it
  // were a real adapter name.
  adapter: string | null;
  requestedModel: string | null;
  totalRuns: number;
  successRate: number;
  averageDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  suppressed: boolean;
}

export interface ObservabilityStepBreakdownEntry {
  // Null exactly when suppressed — see ObservabilityRuntimeBreakdownEntry.
  stepKey: string | null;
  adapter: string | null;
  requestedModel: string | null;
  totalExecutions: number;
  successRate: number;
  p50ExecutionDurationMs: number;
  p95ExecutionDurationMs: number;
  suppressed: boolean;
}

export interface WorkflowObservabilityResponse {
  workflow: { slug: string; versionLabel: string | null };
  owner: ObservabilityAggregateWindow;
  community: ObservabilityCommunityWindow;
  byRuntime: ObservabilityRuntimeBreakdownEntry[];
  steps: ObservabilityStepBreakdownEntry[];
}

export type ObservabilityWindow = "7d" | "30d" | "90d";
