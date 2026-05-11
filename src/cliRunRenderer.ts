import type {
  RunEvent,
  RunObserver,
  RunSnapshot,
  RunnerLogChunk,
  StepDefinition,
  StepDetailSnapshot,
  StepRunStatus,
  WorkflowDefinition,
  WorkflowRunStatus,
} from "./types.js";

interface CliRunRendererOptions {
  workflow: WorkflowDefinition;
  verbose: boolean;
  stream?: NodeJS.WriteStream;
  heartbeatMs?: number;
}

interface StepDescriptor {
  index: number;
  label: string;
}

function isTerminalStatus(status: WorkflowRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function formatCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatDurationMs(value: number): string {
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

function elapsedFrom(iso: string | null): string {
  if (!iso) {
    return "0s";
  }

  const startedAt = Date.parse(iso);
  if (Number.isNaN(startedAt)) {
    return "0s";
  }

  return formatDurationMs(Date.now() - startedAt);
}

function splitLines(value: string): { lines: string[]; remainder: string } {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  const remainder = parts.pop() ?? "";
  return { lines: parts, remainder };
}

function describeAgentStatus(status: StepRunStatus): string {
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

export class CliRunRenderer implements RunObserver {
  private readonly verbose: boolean;
  private readonly stream: NodeJS.WriteStream;
  private readonly heartbeatMs: number;
  private readonly steps = new Map<string, StepDescriptor>();
  private readonly lineBuffers = new Map<string, string>();
  private lastSnapshot: RunSnapshot | null = null;
  private lastStepDetails = new Map<string, StepDetailSnapshot>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private promptPauseCount = 0;
  private started = false;
  private closed = false;

  constructor(options: CliRunRendererOptions) {
    this.verbose = options.verbose;
    this.stream = options.stream ?? process.stderr;
    this.heartbeatMs = options.heartbeatMs ?? 1000;
    options.workflow.steps.forEach((step, index) => {
      this.steps.set(step.key, { index, label: stepLabel(step) });
    });
  }

  onSnapshot(snapshot: RunSnapshot, stepDetails: StepDetailSnapshot[]): void {
    if (this.closed) {
      return;
    }

    const previous = this.lastSnapshot;
    this.lastSnapshot = snapshot;
    this.lastStepDetails = new Map(stepDetails.map((detail) => [detail.stepKey, detail]));

    if ((snapshot.status === "running" || snapshot.status === "waiting_for_approval") && !this.started) {
      this.started = true;
      this.write(`▶ Running workflow "${snapshot.workflowTitle}" (${formatCount(snapshot.steps.length, "step", "steps")})`);
    }

    this.syncHeartbeat(snapshot.status);

    for (const step of snapshot.steps) {
      const prevStatus = previous?.steps.find((entry) => entry.stepKey === step.stepKey)?.status;
      if (prevStatus !== step.status) {
        this.renderStepStatus(snapshot, step.stepKey, step.status);
      }
    }

    if (previous?.status !== snapshot.status && snapshot.status === "waiting_for_approval" && snapshot.waitingForApproval) {
      const waiting = snapshot.waitingForApproval;
      const stepSummary = this.stepSummary(snapshot, waiting.stepKey);
      const validation = waiting.validation ? ` (${waiting.validation})` : "";
      this.write(`◌ ${stepSummary} waiting for approval${validation} - ${this.remainingText(snapshot)}`);
      if (waiting.preview) {
        this.write(`  Approval summary: ${waiting.preview.summary}`);
        for (const item of waiting.preview.items) {
          const status = item.status ? ` [${item.status}]` : "";
          this.write(`  - ${item.title}${status}: ${item.summary}`);
        }
      }
      this.write("  Resolve it in the terminal prompt or with `wfm approve` / `wfm cancel` using the attach API shown above.");
    }

    if (isTerminalStatus(snapshot.status)) {
      this.stopHeartbeat();
      this.flushBuffers();
      this.closed = true;
    }
  }

  onEvent(event: RunEvent): void {
    if (this.closed || !this.verbose) {
      return;
    }

    if (event.type === "agent.started") {
      const stepSummary = this.stepSummary(this.lastSnapshot, event.stepRunId);
      const command = typeof event.payload.command === "string" ? event.payload.command : "agent";
      const args = Array.isArray(event.payload.args) ? event.payload.args.map((value) => String(value)).join(" ") : "";
      const model = typeof event.payload.model === "string" ? ` model=${event.payload.model}` : "";
      this.write(`   ${stepSummary} agent started: ${command}${args ? ` ${args}` : ""}${model}`);
      return;
    }

    if (event.type === "agent.finished") {
      const stepSummary = this.stepSummary(this.lastSnapshot, event.stepRunId);
      const executionStatus = typeof event.payload.executionStatus === "string" ? ` ${event.payload.executionStatus}` : "";
      const exitStatus =
        typeof event.payload.exitStatus === "number" || event.payload.exitStatus === null
          ? ` exit=${String(event.payload.exitStatus)}`
          : "";
      const timedOut = event.payload.timedOut === true ? " timedOut=true" : "";
      this.write(`   ${stepSummary} agent finished:${executionStatus}${exitStatus}${timedOut}`);
      return;
    }

    if (event.type === "step.execution_finished") {
      const stepSummary = this.stepSummary(this.lastSnapshot, event.stepRunId);
      const status = typeof event.payload.status === "string" ? event.payload.status : "unknown";
      const action = typeof event.payload.action === "string" ? ` action=${event.payload.action}` : "";
      const feedbackReason =
        typeof event.payload.feedbackReason === "string" && event.payload.feedbackReason.length > 0
          ? ` reason=${event.payload.feedbackReason}`
          : "";
      this.write(`   ${stepSummary} execution finished: ${status}${action}${feedbackReason}`);
      return;
    }

    if (event.type === "step.retried") {
      const stepSummary = this.stepSummary(this.lastSnapshot, event.stepRunId);
      const attempt = typeof event.payload.attempt === "number" ? ` next attempt ${event.payload.attempt}` : " retry queued";
      this.write(`   ${stepSummary}${attempt}`);
    }
  }

  onLog(log: RunnerLogChunk): void {
    if (this.closed || !this.verbose) {
      return;
    }

    const stepKey = log.stepKey ?? "workflow";
    const bufferKey = `${stepKey}:${log.stream}`;
    const existing = this.lineBuffers.get(bufferKey) ?? "";
    const { lines, remainder } = splitLines(existing + log.text);
    this.lineBuffers.set(bufferKey, remainder);
    for (const line of lines) {
      this.write(`   [${stepKey} ${log.stream}] ${line}`);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.stopHeartbeat();
    this.flushBuffers();
    this.closed = true;
  }

  pauseHeartbeat(): void {
    this.promptPauseCount += 1;
    this.stopHeartbeat();
  }

  resumeHeartbeat(): void {
    this.promptPauseCount = Math.max(0, this.promptPauseCount - 1);
    if (this.promptPauseCount === 0 && this.lastSnapshot) {
      this.syncHeartbeat(this.lastSnapshot.status);
    }
  }

  private renderStepStatus(snapshot: RunSnapshot, stepKey: string, status: StepRunStatus): void {
    if (!this.verbose && status === "runnable") {
      return;
    }

    if (!this.verbose && status === "pending") {
      return;
    }

    const summary = this.stepSummary(snapshot, stepKey);
    const detail = this.lastStepDetails.get(stepKey);

    if (status === "running") {
      const adapter = detail?.adapter ? ` (${detail.adapter})` : "";
      this.write(`→ ${summary} ${describeAgentStatus(status)}${adapter} - ${this.remainingText(snapshot)}`);
      return;
    }

    if (status === "succeeded") {
      const duration = detail?.startedAt ? ` in ${elapsedFrom(detail.startedAt)}` : "";
      this.write(`✓ ${summary} ${describeAgentStatus(status)}${duration} - ${this.remainingText(snapshot)}`);
      return;
    }

    if (status === "failed") {
      const duration = detail?.startedAt ? ` after ${elapsedFrom(detail.startedAt)}` : "";
      this.write(`✗ ${summary} ${describeAgentStatus(status)}${duration} - ${this.remainingText(snapshot)}`);
      return;
    }

    if (status === "cancelled") {
      this.write(`✗ ${summary} ${describeAgentStatus(status)} - ${this.remainingText(snapshot)}`);
      return;
    }

    if (status === "waiting_for_approval") {
      this.write(`◌ ${summary} ${describeAgentStatus(status)} - ${this.remainingText(snapshot)}`);
      return;
    }

    this.write(`… ${summary} ${describeAgentStatus(status)} - ${this.remainingText(snapshot)}`);
  }

  private stepSummary(snapshot: RunSnapshot | null, stepKey?: string): string {
    if (!stepKey) {
      return "[workflow]";
    }

    const descriptor = this.steps.get(stepKey);
    const index = descriptor?.index ?? Math.max(0, snapshot?.steps.findIndex((step) => step.stepKey === stepKey) ?? 0);
    const total = snapshot?.steps.length ?? this.steps.size;
    const label = descriptor?.label ?? stepKey;
    return `[${index + 1}/${Math.max(total, 1)}] ${stepKey}${label === stepKey ? "" : ` - ${label}`}`;
  }

  private remainingText(snapshot: RunSnapshot): string {
    const completed = snapshot.steps.filter((step) => step.status === "succeeded").length;
    const remaining = Math.max(snapshot.steps.length - completed, 0);
    return `${formatCount(remaining, "step remaining", "steps remaining")} - workflow ${elapsedFrom(snapshot.startedAt)}`;
  }

  private syncHeartbeat(status: WorkflowRunStatus): void {
    if (this.promptPauseCount > 0) {
      this.stopHeartbeat();
      return;
    }

    if (status === "running" || status === "waiting_for_approval") {
      if (!this.heartbeat) {
        this.heartbeat = setInterval(() => {
          this.renderHeartbeat();
        }, this.heartbeatMs);
      }
      return;
    }

    this.stopHeartbeat();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) {
      return;
    }

    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private renderHeartbeat(): void {
    if (!this.lastSnapshot || this.closed) {
      return;
    }

    const snapshot = this.lastSnapshot;
    if (snapshot.status === "running" && snapshot.currentStepKey) {
      this.write(`.. ${this.stepSummary(snapshot, snapshot.currentStepKey)} running - ${this.remainingText(snapshot)}`);
      return;
    }

    if (snapshot.status === "waiting_for_approval" && snapshot.waitingForApproval) {
      const waiting = snapshot.waitingForApproval;
      this.write(`.. ${this.stepSummary(snapshot, waiting.stepKey)} waiting - ${this.remainingText(snapshot)}`);
      return;
    }

    if (snapshot.status === "running") {
      this.write(`.. workflow running - ${this.remainingText(snapshot)}`);
    }
  }

  private flushBuffers(): void {
    for (const [bufferKey, text] of this.lineBuffers.entries()) {
      if (!text) {
        continue;
      }
      const [stepKey, stream] = bufferKey.split(":");
      this.write(`   [${stepKey} ${stream}] ${text}`);
    }
    this.lineBuffers.clear();
  }

  private write(line: string): void {
    this.stream.write(`${line}\n`);
  }
}

function stepLabel(step: StepDefinition): string {
  return step.title ?? step.objective ?? step.key;
}
