import type { StepDefinition, StepRunStatus, WorkflowRunStatus } from "./types.js";

export function isTerminalStatus(status: WorkflowRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function formatCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "0s";
  }

  if (value < 1000) {
    return `${Math.max(0, Math.round(value))}ms`;
  }

  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function elapsedFrom(iso: string | null, now: number = Date.now()): string {
  if (!iso) {
    return "0s";
  }

  const startedAt = Date.parse(iso);
  if (Number.isNaN(startedAt)) {
    return "0s";
  }

  return formatDurationMs(now - startedAt);
}

export function splitLines(value: string): { lines: string[]; remainder: string } {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  const remainder = parts.pop() ?? "";
  return { lines: parts, remainder };
}

export function describeAgentStatus(status: StepRunStatus): string {
  switch (status) {
    case "running":
      return "started";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "waiting_for_approval":
      return "waiting for approval";
    case "cancelled":
      return "cancelled";
    default:
      return status.replace(/_/g, " ");
  }
}

export function stepLabel(step: StepDefinition): string {
  return step.title ?? step.objective ?? step.key;
}
