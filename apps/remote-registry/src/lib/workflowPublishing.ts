import type { ManagedWorkflow, ManagedWorkflowVersion, WorkflowAnalyticsItem } from "../types";

export function publishedWorkflowDetailPath(ownerUserId: string, slug: string): string {
  return `/workflow/${encodeURIComponent(ownerUserId)}/${encodeURIComponent(slug)}`;
}

export function latestAnalyticsVersion(item: WorkflowAnalyticsItem): WorkflowAnalyticsItem["downloadsByVersion"][number] | null {
  return item.downloadsByVersion[0] ?? null;
}

export function latestManagedVersion(workflow: ManagedWorkflow): ManagedWorkflowVersion | null {
  return workflow.versions.find((version) => version.isLatest) ?? workflow.versions[0] ?? null;
}
