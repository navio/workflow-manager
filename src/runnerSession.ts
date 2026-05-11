import { randomUUID } from "node:crypto";
import type {
  ApprovalDecision,
  ApprovalDecisionPayload,
  ApprovalRequest,
  ContextSummary,
  RunEvent,
  RunController,
  RunObserver,
  RunnerEventEnvelope,
  RunnerLogChunk,
  RunnerSessionInfo,
  RunSnapshot,
  StepConfigSummary,
  StepDefinition,
  StepDetailSnapshot,
  StepLastExecution,
  StepSnapshot,
  WorkflowDefinition,
} from "./types.js";

interface RunnerSessionStoreOptions {
  runId: string;
  workflow: WorkflowDefinition;
  objective: string;
  objectives: string[];
  host?: string;
  port?: number;
  attachToken?: string;
  startedAt?: string;
  sessionId?: string;
}

interface LogListResult {
  items: RunnerLogChunk[];
  nextCursor: string | null;
}

interface PendingApproval extends ApprovalRequest {
  resolve: (decision: ApprovalDecisionPayload) => void;
  promise: Promise<ApprovalDecisionPayload>;
}

type Subscriber = (event: RunnerEventEnvelope) => void;

function contextSummary(value: unknown): ContextSummary {
  if (typeof value === "string") {
    return { type: "string", length: value.length };
  }

  if (value && typeof value === "object") {
    return { type: "object", keys: Object.keys(value as Record<string, unknown>).sort() };
  }

  return { type: "none" };
}

function stepConfig(step: StepDefinition): StepConfigSummary {
  return {
    model: typeof step.taskSpec?.init?.model === "string" ? step.taskSpec.init.model : null,
    skills: step.taskSpec?.init?.skills ?? [],
    mcps: step.taskSpec?.init?.mcps ?? [],
    systemPrompts: step.taskSpec?.init?.systemPrompts ?? [],
    contextSummary: contextSummary(step.taskSpec?.init?.context),
  };
}

function cloneSnapshot(snapshot: RunSnapshot): RunSnapshot {
  return {
    ...snapshot,
    objectives: [...snapshot.objectives],
    waitingForApproval: snapshot.waitingForApproval ? { ...snapshot.waitingForApproval } : null,
    steps: snapshot.steps.map((step) => ({ ...step })),
  };
}

function cloneStepDetails(stepDetails: StepDetailSnapshot[]): StepDetailSnapshot[] {
  return stepDetails.map((detail) => ({
    ...detail,
    dependsOn: [...detail.dependsOn],
    config: {
      ...detail.config,
      skills: [...detail.config.skills],
      mcps: [...detail.config.mcps],
      systemPrompts: [...detail.config.systemPrompts],
      contextSummary: {
        ...detail.config.contextSummary,
        keys: detail.config.contextSummary.keys ? [...detail.config.contextSummary.keys] : undefined,
      },
    },
    lastExecution: { ...detail.lastExecution },
  }));
}

function envelopeFromEvent(event: RunEvent): RunnerEventEnvelope {
  return {
    id: event.id,
    sequence: event.sequenceNumber,
    type: event.type,
    runId: event.runId,
    stepKey: event.stepRunId,
    occurredAt: event.occurredAt,
    data: { ...event.payload },
  };
}

export class RunnerSessionStore implements RunObserver, RunController {
  private readonly workflow: WorkflowDefinition;
  private readonly subscribers = new Set<Subscriber>();
  private readonly maxLogChunks = 2000;
  private snapshotState: RunSnapshot;
  private stepDetailsState: StepDetailSnapshot[];
  private readonly eventHistory: RunnerEventEnvelope[] = [];
  private readonly logHistory: RunnerLogChunk[] = [];
  private readonly sessionState: RunnerSessionInfo;
  private pendingApproval: PendingApproval | null = null;

  constructor(options: RunnerSessionStoreOptions) {
    this.workflow = options.workflow;
    const startedAt = options.startedAt ?? new Date().toISOString();
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 0;
    const attachToken = options.attachToken ?? randomUUID();
    const steps: StepSnapshot[] = options.workflow.steps.map((step) => ({
      stepKey: step.key,
      status: "pending",
      attempt: 0,
      confirmed: false,
      adapter: step.taskSpec?.adapterKey ?? "approval",
      startedAt: null,
      updatedAt: startedAt,
      finishedAt: null,
    }));
    const emptyExecution: StepLastExecution = {
      executionStatus: null,
      qaAction: null,
      feedbackReason: null,
    };
    this.stepDetailsState = options.workflow.steps.map((step, index) => ({
      ...steps[index],
      kind: step.kind,
      objective: step.objective ?? step.title ?? null,
      dependsOn: step.dependsOn ?? [],
      config: stepConfig(step),
      lastExecution: { ...emptyExecution },
    }));
    this.snapshotState = {
      runId: options.runId,
      workflowKey: options.workflow.key,
      workflowTitle: options.workflow.title,
      status: "queued",
      currentStepKey: null,
      startedAt: null,
      updatedAt: startedAt,
      endedAt: null,
      objective: options.objective,
      objectives: [...options.objectives],
      waitingForApproval: null,
      steps,
    };
    this.sessionState = {
      sessionId: options.sessionId ?? randomUUID(),
      pid: process.pid,
      host,
      port,
      baseUrl: `http://${host}:${port}`,
      attachToken,
      startedAt,
      run: {
        runId: options.runId,
        workflowKey: options.workflow.key,
        workflowTitle: options.workflow.title,
        status: "queued",
      },
    };
  }

  setBinding(host: string, port: number): void {
    this.sessionState.host = host;
    this.sessionState.port = port;
    this.sessionState.baseUrl = `http://${host}:${port}`;
  }

  sessionInfo(): RunnerSessionInfo {
    return {
      ...this.sessionState,
      run: { ...this.sessionState.run },
    };
  }

  attachToken(): string {
    return this.sessionState.attachToken;
  }

  runId(): string {
    return this.snapshotState.runId;
  }

  snapshot(): RunSnapshot {
    return cloneSnapshot(this.snapshotState);
  }

  stepDetail(stepKey: string): StepDetailSnapshot | null {
    const detail = this.stepDetailsState.find((step) => step.stepKey === stepKey);
    if (!detail) {
      return null;
    }

    return cloneStepDetails([detail])[0] ?? null;
  }

  listLogs(stepKey?: string, limit = 200, cursor?: string): LogListResult {
    const parsedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 200;
    const filtered = stepKey ? this.logHistory.filter((log) => log.stepKey === stepKey) : this.logHistory;
    const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
    const items = filtered.slice(offset, offset + parsedLimit).map((item) => ({ ...item }));
    const nextCursor = offset + parsedLimit < filtered.length ? String(offset + parsedLimit) : null;
    return { items, nextCursor };
  }

  events(sinceSequence?: number, includeLogs = true): RunnerEventEnvelope[] {
    return this.eventHistory
      .filter((event) => (sinceSequence ? event.sequence > sinceSequence : true))
      .filter((event) => includeLogs || (event.type !== "agent.stdout" && event.type !== "agent.stderr"))
      .map((event) => ({ ...event, data: { ...event.data } }));
  }

  subscribe(listener: Subscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  onEvent(event: RunEvent): void {
    const envelope = envelopeFromEvent(event);
    this.eventHistory.push(envelope);
    for (const subscriber of this.subscribers) {
      subscriber(envelope);
    }
  }

  onSnapshot(snapshot: RunSnapshot, stepDetails: StepDetailSnapshot[]): void {
    this.snapshotState = cloneSnapshot(snapshot);
    this.stepDetailsState = cloneStepDetails(stepDetails);
    this.sessionState.run.status = snapshot.status;
  }

  onLog(log: RunnerLogChunk): void {
    this.logHistory.push({ ...log });
    if (this.logHistory.length > this.maxLogChunks) {
      this.logHistory.splice(0, this.logHistory.length - this.maxLogChunks);
    }
  }

  publicSession(): Omit<RunnerSessionInfo, "attachToken"> {
    const { attachToken: _attachToken, ...publicInfo } = this.sessionInfo();
    return publicInfo;
  }

  isKnownRun(runId: string): boolean {
    return this.snapshotState.runId === runId;
  }

  workflowDefinition(): WorkflowDefinition {
    return this.workflow;
  }

  waitForDecision(request: ApprovalRequest): Promise<ApprovalDecisionPayload> {
    if (this.pendingApproval?.stepKey === request.stepKey) {
      return this.pendingApproval.promise;
    }

    let resolveDecision: ((decision: ApprovalDecisionPayload) => void) | undefined;
    const promise = new Promise<ApprovalDecisionPayload>((resolve) => {
      resolveDecision = resolve;
    });

    this.pendingApproval = {
      ...request,
      promise,
      resolve: resolveDecision!,
    };
    return promise;
  }

  approve(
    stepKey?: string,
    metadata: Omit<ApprovalDecisionPayload, "decision"> = {}
  ): { ok: boolean; reason?: string; stepKey?: string } {
    return this.resolvePendingApproval("approved", stepKey, metadata);
  }

  cancel(
    stepKey?: string,
    metadata: Omit<ApprovalDecisionPayload, "decision"> = {}
  ): { ok: boolean; reason?: string; stepKey?: string } {
    return this.resolvePendingApproval("cancelled", stepKey, metadata);
  }

  private resolvePendingApproval(
    decision: ApprovalDecision,
    stepKey?: string,
    metadata: Omit<ApprovalDecisionPayload, "decision"> = {}
  ): { ok: boolean; reason?: string; stepKey?: string } {
    if (!this.pendingApproval) {
      return { ok: false, reason: "No step is waiting for approval" };
    }

    if (stepKey && this.pendingApproval.stepKey !== stepKey) {
      return {
        ok: false,
        reason: `Step ${stepKey} is not currently waiting for approval`,
      };
    }

    const pending = this.pendingApproval;
    this.pendingApproval = null;
    pending.resolve({ decision, ...metadata });
    return { ok: true, stepKey: pending.stepKey };
  }
}
