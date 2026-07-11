// RunObserver implementation for `wfm run --ui`: owns the mutable TUI state
// (latest snapshot, per-step logs, selection/follow, transient status
// messages), wires TerminalScreen input/output, and composes+paints frames
// via the pure renderFrame(). This is the only piece that talks timers,
// process streams, and the session approve/resume/cancel controls — layout
// math and terminal I/O stay in layout.ts / screen.ts.
import { isTerminalStatus } from "../runFormat.js";
import type { RunEvent, RunObserver, RunSnapshot, RunnerLogChunk, StepDetailSnapshot, StepRunStatus, WorkflowDefinition } from "../types.js";
import { type TuiFrameState, renderFrame } from "./layout.js";
import { TuiLogStore } from "./logStore.js";
import { type KeyEvent, TerminalScreen } from "./screen.js";
import { type Theme, createTheme } from "./theme.js";

import picocolors from "picocolors";

export interface TuiSessionControls {
  approve(stepKey?: string, metadata?: { actor?: string; note?: string; source?: string }): { ok: boolean; reason?: string };
  resume(stepKey?: string, metadata?: { actor?: string; note?: string; source?: string }): { ok: boolean; reason?: string };
  cancel(stepKey?: string, metadata?: { actor?: string; note?: string; source?: string }): { ok: boolean; reason?: string };
}

export interface TuiRunRendererOptions {
  workflow: WorkflowDefinition;
  session: TuiSessionControls;
  attachUrl: string;
  attachToken: string;
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
  redrawMs?: number;
  tickMs?: number;
  now?: () => number;
  colorEnabled?: boolean;
}

const DEFAULT_REDRAW_MS = 80;
const DEFAULT_TICK_MS = 1000;
const STATUS_MESSAGE_TTL_MS = 4000;

const STEP_TERMINAL_STATUSES: ReadonlySet<StepRunStatus> = new Set(["succeeded", "failed", "cancelled"]);

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function buildEventMetaText(event: RunEvent): string | null {
  const payload = event.payload;

  if (event.type === "agent.started") {
    const command = readString(payload, "command") ?? "agent";
    const args = Array.isArray(payload.args) ? payload.args.map((value) => String(value)).join(" ") : "";
    const model = readString(payload, "model");
    return `agent started: ${command}${args ? ` ${args}` : ""}${model ? ` model=${model}` : ""}`;
  }

  if (event.type === "agent.finished") {
    const status = readString(payload, "executionStatus") ?? "unknown";
    const exitStatus =
      typeof payload.exitStatus === "number" || payload.exitStatus === null ? ` exit=${String(payload.exitStatus)}` : "";
    const timedOut = payload.timedOut === true ? " timedOut=true" : "";
    return `agent finished: ${status}${exitStatus}${timedOut}`;
  }

  if (event.type === "step.execution_finished") {
    const status = readString(payload, "status") ?? "unknown";
    const action = readString(payload, "action");
    const feedbackReason = readString(payload, "feedbackReason");
    return `execution finished: ${status}${action ? ` action=${action}` : ""}${feedbackReason ? ` reason=${feedbackReason}` : ""}`;
  }

  if (event.type === "step.validation_started") {
    const adapter = readString(payload, "adapter");
    const criteria = readString(payload, "criteria");
    return `agent validation started${adapter ? ` (${adapter})` : ""}${criteria ? ` criteria=${criteria}` : ""}`;
  }

  if (event.type === "step.validation_finished") {
    const status = readString(payload, "status") ?? "unknown";
    const action = readString(payload, "action");
    const feedbackReason = readString(payload, "feedbackReason");
    return `agent validation: ${status}${action ? ` action=${action}` : ""}${feedbackReason ? ` reason=${feedbackReason}` : ""}`;
  }

  if (event.type === "step.retried") {
    const attempt = typeof payload.attempt === "number" ? payload.attempt : undefined;
    return attempt !== undefined ? `retry scheduled (attempt ${attempt})` : "retry scheduled";
  }

  if (event.type === "approval.resolved") {
    const decision = readString(payload, "decision") ?? "unknown";
    const actor = readString(payload, "actor");
    return `approval resolved: ${decision}${actor ? ` by ${actor}` : ""}`;
  }

  return null;
}

export class TuiRunRenderer implements RunObserver {
  private readonly workflow: WorkflowDefinition;
  private readonly session: TuiSessionControls;
  private readonly attachUrl: string;
  private readonly attachToken: string;
  private readonly stdout: NodeJS.WriteStream;
  private readonly stdin: NodeJS.ReadStream;
  private readonly redrawMs: number;
  private readonly tickMs: number;
  private readonly nowFn: () => number;
  private readonly theme: Theme;
  private readonly screen: TerminalScreen;

  private snapshot: RunSnapshot | null = null;
  private stepDetails = new Map<string, StepDetailSnapshot>();
  private readonly logs = new TuiLogStore();
  private selectedStepKey: string | null = null;
  private follow = true;
  private statusMessage: string | null = null;
  private statusMessageExpiresAt: number | null = null;
  private dirty = true;

  private redrawTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private stopped = false;

  constructor(options: TuiRunRendererOptions) {
    this.workflow = options.workflow;
    this.session = options.session;
    this.attachUrl = options.attachUrl;
    this.attachToken = options.attachToken;
    this.stdout = options.stdout ?? process.stdout;
    this.stdin = options.stdin ?? process.stdin;
    this.redrawMs = options.redrawMs ?? DEFAULT_REDRAW_MS;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.nowFn = options.now ?? Date.now;
    this.theme = createTheme(options.colorEnabled ?? picocolors.isColorSupported);

    this.screen = new TerminalScreen({
      stdout: this.stdout,
      stdin: this.stdin,
      onKey: this.handleKey,
      onResize: this.handleResize,
    });
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.stopped = false;
    this.screen.start();

    if (this.redrawMs > 0) {
      this.redrawTimer = setInterval(() => {
        if (this.dirty) {
          this.renderNow();
        }
      }, this.redrawMs);
    }

    if (this.tickMs > 0) {
      this.tickTimer = setInterval(() => {
        const status = this.snapshot?.status;
        if (status === "running" || status === "waiting_for_approval") {
          this.markDirty();
        }
      }, this.tickMs);
    }

    // Seed an initial (pending / snapshot-null) frame so the alt screen never
    // shows a blank body while waiting on the first onSnapshot.
    this.renderNow();
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.started = false;

    if (this.redrawTimer) {
      clearInterval(this.redrawTimer);
      this.redrawTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.screen.stop();
  }

  onSnapshot(snapshot: RunSnapshot, stepDetails: StepDetailSnapshot[]): void {
    this.snapshot = snapshot;
    this.stepDetails = new Map(stepDetails.map((detail) => [detail.stepKey, detail]));

    if (this.follow) {
      const firstNonTerminal = snapshot.steps.find((step) => !STEP_TERMINAL_STATUSES.has(step.status))?.stepKey;
      this.selectedStepKey = snapshot.currentStepKey ?? firstNonTerminal ?? this.selectedStepKey;
    }

    if (isTerminalStatus(snapshot.status)) {
      this.logs.flushPartialLines();
    }

    this.markDirty();
  }

  onEvent(event: RunEvent): void {
    const text = buildEventMetaText(event);
    if (text === null) {
      return;
    }
    this.logs.appendMeta(event.stepRunId, text);
    this.markDirty();
  }

  onLog(log: RunnerLogChunk): void {
    this.logs.appendChunk(log);
    this.markDirty();
  }

  handleKey = (key: KeyEvent): void => {
    const name = key.name;

    if (name === "up" || name === "k") {
      this.follow = false;
      this.moveSelection(-1);
      this.markDirty();
      return;
    }

    if (name === "down" || name === "j") {
      this.follow = false;
      this.moveSelection(1);
      this.markDirty();
      return;
    }

    if (name === "f") {
      this.follow = true;
      this.selectedStepKey = this.snapshot?.currentStepKey ?? this.selectedStepKey;
      this.markDirty();
      return;
    }

    if (name === "q" || (key.ctrl && name === "c")) {
      this.handleQuit();
      return;
    }

    if (name === "a") {
      this.handleApprove();
      return;
    }

    if (name === "r") {
      this.handleResume();
      return;
    }

    if (name === "c") {
      this.handleCancel();
      return;
    }

    this.markDirty();
  };

  renderNow(): string[] {
    const rows = renderFrame(this.composeFrame());
    this.screen.paint(rows);
    this.dirty = false;
    return rows;
  }

  private handleResize = (): void => {
    this.markDirty();
  };

  private handleApprove(): void {
    const waiting = this.snapshot?.waitingForApproval;
    if (!waiting) {
      this.markDirty();
      return;
    }

    if (waiting.validation === "external") {
      this.setStatusMessage("external step — press r to resume");
      this.markDirty();
      return;
    }

    const result = this.session.approve(waiting.stepKey, { actor: "cli", source: "tui" });
    if (!result.ok) {
      this.setStatusMessage(`approve failed: ${result.reason ?? "unknown error"}`);
    }
    this.markDirty();
  }

  private handleResume(): void {
    const waiting = this.snapshot?.waitingForApproval;
    if (!waiting) {
      this.markDirty();
      return;
    }

    const result = this.session.resume(waiting.stepKey, { actor: "cli", source: "tui" });
    if (!result.ok) {
      this.setStatusMessage(`resume failed: ${result.reason ?? "unknown error"}`);
    }
    this.markDirty();
  }

  private handleCancel(): void {
    const waiting = this.snapshot?.waitingForApproval;
    if (!waiting) {
      this.setStatusMessage("press q to quit; c cancels only a pending approval");
      this.markDirty();
      return;
    }

    const result = this.session.cancel(waiting.stepKey, { actor: "cli", source: "tui" });
    if (!result.ok) {
      this.setStatusMessage(`cancel failed: ${result.reason ?? "unknown error"}`);
    }
    this.markDirty();
  }

  private handleQuit(): void {
    const status = this.snapshot?.status;
    if (status && isTerminalStatus(status)) {
      // Run already finished; cmdRun owns process exit from here.
      this.markDirty();
      return;
    }

    this.session.cancel(undefined, { actor: "cli", source: "tui", note: "cancelled from TUI" });
    this.setStatusMessage("cancelling…");
    this.markDirty();
  }

  private moveSelection(delta: number): void {
    const steps = this.snapshot?.steps ?? [];
    if (steps.length === 0) {
      return;
    }

    const currentIndex = this.selectedStepKey ? steps.findIndex((step) => step.stepKey === this.selectedStepKey) : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : delta > 0 ? -1 : 0;
    const nextIndex = Math.min(Math.max(baseIndex + delta, 0), steps.length - 1);
    this.selectedStepKey = steps[nextIndex].stepKey;
  }

  private setStatusMessage(message: string): void {
    this.statusMessage = message;
    this.statusMessageExpiresAt = this.nowFn() + STATUS_MESSAGE_TTL_MS;
  }

  private currentStatusMessage(now: number): string | null {
    if (this.statusMessage && this.statusMessageExpiresAt !== null && now >= this.statusMessageExpiresAt) {
      this.statusMessage = null;
      this.statusMessageExpiresAt = null;
    }
    return this.statusMessage;
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.redrawMs === 0) {
      this.renderNow();
    }
  }

  private composeFrame(): TuiFrameState {
    const { columns, rows } = this.screen.size();
    const now = this.nowFn();
    return {
      snapshot: this.snapshot,
      stepDetails: this.stepDetails,
      logs: this.logs,
      selectedStepKey: this.selectedStepKey,
      follow: this.follow,
      attachUrl: this.attachUrl,
      attachToken: this.attachToken,
      statusMessage: this.currentStatusMessage(now),
      width: columns,
      height: rows,
      now,
      theme: this.theme,
    };
  }
}
