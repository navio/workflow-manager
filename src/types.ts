export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

export type StepRunStatus =
  | "pending"
  | "runnable"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type StepKind = "task" | "approval" | "system";
export type NodeType = "AGENT" | "HUMAN" | "SYSTEM";

export type ExecutionStatus = "SUCCESS" | "QA_REJECTED" | "YIELD_EXTERNAL" | "FAILED";
export type QaAction = "PROCEED" | "RETRY_CURRENT" | "ROLLBACK_PREVIOUS" | "RESTART_ALL";
export type ValidationMode = "none" | "human" | "external";
export type AdapterKey = "mock" | "opencode" | "codex" | "claude-code";

export interface RetryPolicy {
  maxAttempts?: number;
}

export interface ValidationSpec {
  mode?: ValidationMode;
  required?: boolean;
  autoConfirm?: boolean;
  confirmerPolicy?: string;
}

export interface TaskInitConfig {
  context?: Record<string, unknown> | string;
  skills?: string[];
  mcps?: string[];
  systemPrompts?: string[];
  model?: string;
}

export interface StepDefinition {
  key: string;
  kind: StepKind;
  title?: string;
  objective?: string;
  dependsOn?: string[];
  timeoutSec?: number;
  retryPolicy?: RetryPolicy;
  validation?: ValidationSpec;
  taskSpec?: {
    adapterKey?: AdapterKey;
    capabilityRequirements?: string[];
    init?: TaskInitConfig;
    payload?: Record<string, unknown>;
  };
  approvalSpec?: {
    approverPolicy?: string;
    autoApprove?: boolean;
    validation?: ValidationSpec;
  };
}

export interface SkillUpstream {
  repo?: string;
  ref?: string;
  path?: string;
}

export interface SkillEntry {
  source?: string;
  content?: string;
  upstream?: SkillUpstream;
  contentSha256?: string;
}

export interface WorkflowDefinition {
  key: string;
  title: string;
  description?: string;
  objectives?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  defaultRetryPolicy?: RetryPolicy;
  skills?: Record<string, SkillEntry>;
  steps: StepDefinition[];
}

export interface InputEnvelope {
  global_context: {
    workflow_id: string;
    primary_objective: string;
    workflow_objectives: string[];
    global_state: Record<string, unknown>;
  };
  step_context: {
    step_id: string;
    step_objective: string;
    previous_output: Record<string, unknown>;
    assigned_node_type: NodeType;
  };
  priming_configuration: {
    required_skills: string[];
    mcp_endpoints: string[];
    system_prompts: string[];
    context?: Record<string, unknown> | string;
    adapter?: AdapterKey;
    model?: string;
  };
}

export interface OutputEnvelope {
  step_id: string;
  execution_status: ExecutionStatus;
  qa_routing: {
    action: QaAction;
    feedback_reason: string;
  };
  mutated_payload: Record<string, unknown>;
  metadata: {
    execution_time_ms: number;
    external_intervention_required: boolean;
    intervention_details?: Record<string, unknown>;
  };
}

export interface StepRun {
  stepKey: string;
  status: StepRunStatus;
  attempt: number;
  confirmed: boolean;
  output?: Record<string, unknown>;
}

export interface RunResult {
  runId: string;
  status: WorkflowRunStatus;
  outputs: Record<string, unknown>;
  stepRuns: StepRun[];
  events: RunEvent[];
}

export interface RunOptions {
  objective?: string;
  input?: Record<string, unknown>;
  actor?: string;
  confirmations?: string[];
  autoConfirmAll?: boolean;
  interactive?: boolean;
  workflowFilePath?: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  stepRunId?: string;
  type:
    | "run.created"
    | "run.started"
    | "run.waiting_for_approval"
    | "step.runnable"
    | "step.claimed"
    | "step.execution_started"
    | "step.execution_finished"
    | "step.waiting_for_approval"
    | "approval.resolved"
    | "step.retried"
    | "step.confirmed"
    | "run.completed"
    | "run.failed"
    | "run.cancelled";
  sequenceNumber: number;
  occurredAt: string;
  actor: string;
  payload: Record<string, unknown>;
}
