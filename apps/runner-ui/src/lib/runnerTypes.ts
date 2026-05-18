export type WorkflowRunStatus = "queued" | "running" | "waiting_for_approval" | "paused" | "succeeded" | "failed" | "cancelled";

export type StepRunStatus = "pending" | "runnable" | "running" | "waiting_for_approval" | "succeeded" | "failed" | "cancelled";

export type StepKind = "task" | "approval" | "system";

export interface RunnerSessionInfo {
  sessionId: string;
  pid: number;
  host: string;
  port: number;
  baseUrl: string;
  attachToken: string;
  startedAt: string;
  run: {
    runId: string;
    workflowKey: string;
    workflowTitle: string;
    status: WorkflowRunStatus;
  };
}

export interface StepSnapshot {
  stepKey: string;
  status: StepRunStatus;
  attempt: number;
  confirmed: boolean;
  adapter: "approval" | string;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
}

export interface ContextSummary {
  type: "none" | "string" | "object";
  length?: number;
  keys?: string[];
}

export interface StepConfigSummary {
  model: string | null;
  skills: string[];
  mcps: string[];
  systemPrompts: string[];
  contextSummary: ContextSummary;
}

export interface StepLastExecution {
  executionStatus: string | null;
  qaAction: string | null;
  feedbackReason: string | null;
}

export interface StepDetailSnapshot extends StepSnapshot {
  kind: StepKind;
  objective: string | null;
  dependsOn: string[];
  config: StepConfigSummary;
  lastExecution: StepLastExecution;
}

export interface WaitingForApprovalState {
  stepKey: string;
  reason: string;
  validation?: string;
  preview?: unknown;
}

export interface RunSnapshot {
  runId: string;
  workflowKey: string;
  workflowTitle: string;
  status: WorkflowRunStatus;
  currentStepKey: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  endedAt: string | null;
  objective: string;
  objectives: string[];
  waitingForApproval: WaitingForApprovalState | null;
  steps: StepSnapshot[];
}

export interface RunnerLogChunk {
  id: string;
  runId: string;
  stepKey?: string;
  stream: "stdout" | "stderr";
  text: string;
  occurredAt: string;
}

export interface RunnerEventEnvelope {
  id: string;
  sequence: number;
  type: string;
  runId: string;
  stepKey?: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface RunnerLogList {
  items: RunnerLogChunk[];
  nextCursor: string | null;
}

export interface ApprovalControlPayload {
  stepKey: string;
  actor?: string;
  note?: string;
  source?: string;
}

export interface ApprovalControlResponse {
  ok: true;
  decision: "approved" | "cancelled";
  stepKey: string | null;
  actor: string | null;
  note: string | null;
  source: string;
}
