import { PassThrough } from "node:stream";
import { describe, expect, it } from "bun:test";
import { stripAnsi } from "../src/tui/ansi.ts";
import { TuiRunRenderer, type TuiSessionControls } from "../src/tui/tuiRunRenderer.ts";
import type { RunEvent, RunSnapshot, RunnerLogChunk, StepSnapshot, WorkflowDefinition } from "../src/types.ts";

const NOW = Date.parse("2026-07-10T12:05:00.000Z");

// --- fake process streams ----------------------------------------------------------

class FakeStdout extends PassThrough {
  isTTY = true;
  columns = 100;
  rows = 30;
  private chunks: string[] = [];

  constructor() {
    super();
    this.on("data", (chunk: Buffer) => {
      this.chunks.push(chunk.toString());
    });
  }

  output(): string {
    return this.chunks.join("");
  }

  reset(): void {
    this.chunks = [];
  }
}

class FakeStdin extends PassThrough {
  isTTY = true;

  setRawMode(_mode: boolean): this {
    return this;
  }
}

// --- fake session controls ---------------------------------------------------------

type SessionCall = {
  method: "approve" | "resume" | "cancel";
  stepKey?: string;
  metadata?: { actor?: string; note?: string; source?: string };
};

class FakeSession implements TuiSessionControls {
  calls: SessionCall[] = [];
  approveResult: { ok: boolean; reason?: string } = { ok: true };
  resumeResult: { ok: boolean; reason?: string } = { ok: true };
  cancelResult: { ok: boolean; reason?: string } = { ok: true };

  approve(stepKey?: string, metadata?: SessionCall["metadata"]): { ok: boolean; reason?: string } {
    this.calls.push({ method: "approve", stepKey, metadata });
    return this.approveResult;
  }

  resume(stepKey?: string, metadata?: SessionCall["metadata"]): { ok: boolean; reason?: string } {
    this.calls.push({ method: "resume", stepKey, metadata });
    return this.resumeResult;
  }

  cancel(stepKey?: string, metadata?: SessionCall["metadata"]): { ok: boolean; reason?: string } {
    this.calls.push({ method: "cancel", stepKey, metadata });
    return this.cancelResult;
  }
}

// --- fixtures ------------------------------------------------------------------------

const workflow: WorkflowDefinition = {
  key: "story-pipeline",
  title: "Story Pipeline",
  steps: [
    { key: "discover", kind: "task" },
    { key: "plan", kind: "task" },
    { key: "implement", kind: "task" },
    { key: "review-gate", kind: "approval" },
    { key: "release", kind: "task" },
  ],
};

function step(overrides: Partial<StepSnapshot> & { stepKey: string }): StepSnapshot {
  return {
    status: "pending",
    attempt: 1,
    confirmed: false,
    adapter: "mock",
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function baseSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    runId: "8d2ea4f9-run",
    workflowKey: "story-pipeline",
    workflowTitle: "Story Pipeline",
    status: "running",
    currentStepKey: "implement",
    startedAt: "2026-07-10T12:03:18.000Z",
    updatedAt: "2026-07-10T12:04:59.000Z",
    endedAt: null,
    objective: "Ship the story",
    objectives: [],
    waitingForApproval: null,
    steps: [
      step({ stepKey: "discover", status: "succeeded", adapter: "mock", startedAt: "2026-07-10T12:03:18.000Z", finishedAt: "2026-07-10T12:03:21.200Z" }),
      step({ stepKey: "plan", status: "succeeded", adapter: "mock", startedAt: "2026-07-10T12:03:21.200Z", finishedAt: "2026-07-10T12:03:24.000Z" }),
      step({ stepKey: "implement", status: "running", adapter: "claude-code", startedAt: "2026-07-10T12:04:19.000Z" }),
      step({ stepKey: "review-gate", status: "pending", adapter: "approval" }),
      step({ stepKey: "release", status: "pending", adapter: "opencode" }),
    ],
    ...overrides,
  };
}

function logChunk(overrides: Partial<RunnerLogChunk> & { text: string }): RunnerLogChunk {
  return {
    id: "chunk-1",
    runId: "8d2ea4f9-run",
    stream: "stdout",
    occurredAt: "2026-07-10T12:04:20.000Z",
    ...overrides,
  };
}

function runEvent(overrides: Partial<RunEvent> & { type: RunEvent["type"] }): RunEvent {
  return {
    id: "event-1",
    runId: "8d2ea4f9-run",
    sequenceNumber: 1,
    occurredAt: "2026-07-10T12:04:20.000Z",
    actor: "system",
    payload: {},
    ...overrides,
  };
}

function makeRenderer(overrides?: { session?: FakeSession; snapshotOverride?: Partial<RunSnapshot> }) {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const session = overrides?.session ?? new FakeSession();
  const renderer = new TuiRunRenderer({
    workflow,
    session,
    attachUrl: "http://127.0.0.1:61233",
    attachToken: "3f9c11a2b3c4d5e6",
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    redrawMs: 0,
    tickMs: 0,
    now: () => NOW,
    colorEnabled: false,
  });
  return { renderer, stdout, stdin, session };
}

function joinedRows(rows: string[]): string {
  return rows.map(stripAnsi).join("\n");
}

// --- tests -----------------------------------------------------------------------------

describe("TuiRunRenderer.start / stop", () => {
  it("enters the alt screen and paints an initializing frame on start", () => {
    const { renderer, stdout } = makeRenderer();
    renderer.start();

    expect(stdout.output()).toContain("\x1b[?1049h");
    expect(stripAnsi(stdout.output())).toContain("wfm run");

    renderer.stop();
  });

  it("leaves the alt screen on stop and is idempotent", () => {
    const { renderer, stdout } = makeRenderer();
    renderer.start();
    stdout.reset();

    renderer.stop();
    expect(stdout.output()).toContain("\x1b[?1049l");

    stdout.reset();
    renderer.stop();
    expect(stdout.output()).toBe("");
  });
});

describe("TuiRunRenderer.onSnapshot / renderNow", () => {
  it("renders step keys and workflow progress once a snapshot arrives", () => {
    const { renderer } = makeRenderer();
    renderer.start();

    renderer.onSnapshot(baseSnapshot(), []);
    const rows = renderer.renderNow();
    const joined = joinedRows(rows);

    for (const key of ["discover", "plan", "implement", "review-gate", "release"]) {
      expect(joined).toContain(key);
    }
    expect(joined).toContain("2/5 done");
    expect(joined).toContain("running");

    renderer.stop();
  });

  it("follows currentStepKey across snapshots while follow is enabled", () => {
    const { renderer } = makeRenderer();
    renderer.start();

    renderer.onSnapshot(baseSnapshot({ currentStepKey: "implement" }), []);
    let joined = joinedRows(renderer.renderNow());
    expect(joined).toContain("Activity: implement");

    renderer.onSnapshot(baseSnapshot({ currentStepKey: "release" }), []);
    joined = joinedRows(renderer.renderNow());
    expect(joined).toContain("Activity: release");

    renderer.stop();
  });
});

describe("TuiRunRenderer.onLog / onEvent", () => {
  it("appends log and meta vocabulary lines for the selected step's activity pane", () => {
    const { renderer, stdout } = makeRenderer();
    stdout.columns = 160; // wide enough that the longer meta lines aren't truncated
    renderer.start();
    renderer.onSnapshot(baseSnapshot({ currentStepKey: "implement" }), []);

    renderer.onLog(logChunk({ stepKey: "implement", stream: "stdout", text: "Writing src/feature.ts\n" }));
    renderer.onEvent(
      runEvent({
        type: "agent.started",
        stepRunId: "implement",
        payload: { command: "pi", args: ["-p", "run"], model: "opus" },
      }),
    );
    renderer.onEvent(
      runEvent({
        type: "step.execution_finished",
        stepRunId: "implement",
        payload: { status: "QA_REJECTED", action: "RETRY_CURRENT", feedbackReason: "tests flaky" },
      }),
    );

    const joined = joinedRows(renderer.renderNow());
    expect(joined).toContain("Writing src/feature.ts");
    expect(joined).toContain("agent started: pi -p run model=opus");
    expect(joined).toContain("execution finished: QA_REJECTED action=RETRY_CURRENT reason=tests flaky");

    renderer.stop();
  });

  it("ignores event types with no meta vocabulary mapping", () => {
    const { renderer } = makeRenderer();
    renderer.start();
    renderer.onSnapshot(baseSnapshot({ currentStepKey: "implement" }), []);

    renderer.onEvent(runEvent({ type: "step.claimed", stepRunId: "implement" }));
    const joined = joinedRows(renderer.renderNow());
    // Nothing beyond the standard chrome should mention "claimed".
    expect(joined).not.toContain("claimed");

    renderer.stop();
  });
});

describe("TuiRunRenderer.handleKey — navigation", () => {
  it("moves selection with up/down and disables follow, f re-enables it", () => {
    const { renderer } = makeRenderer();
    renderer.start();
    renderer.onSnapshot(baseSnapshot({ currentStepKey: "implement" }), []);
    expect(joinedRows(renderer.renderNow())).toContain("Activity: implement");

    renderer.handleKey({ name: "up" });
    expect(joinedRows(renderer.renderNow())).toContain("Activity: plan");

    // follow is now disabled: a new snapshot with a different currentStepKey
    // must not move the selection.
    renderer.onSnapshot(baseSnapshot({ currentStepKey: "release" }), []);
    expect(joinedRows(renderer.renderNow())).toContain("Activity: plan");

    renderer.handleKey({ name: "down" });
    expect(joinedRows(renderer.renderNow())).toContain("Activity: implement");

    // f re-follows and snaps to the current step immediately.
    renderer.handleKey({ name: "f" });
    expect(joinedRows(renderer.renderNow())).toContain("Activity: release");

    renderer.stop();
  });
});

describe("TuiRunRenderer.handleKey — approvals", () => {
  it("'a' approves a human-validation wait with the right stepKey and source", () => {
    const { renderer, session } = makeRenderer();
    renderer.start();
    renderer.onSnapshot(
      baseSnapshot({
        status: "waiting_for_approval",
        waitingForApproval: { stepKey: "review-gate", reason: "manual sign-off", validation: "human" },
      }),
      [],
    );

    renderer.handleKey({ name: "a" });

    expect(session.calls).toEqual([{ method: "approve", stepKey: "review-gate", metadata: { actor: "cli", source: "tui" } }]);

    renderer.stop();
  });

  it("'r' resumes an external-validation wait", () => {
    const { renderer, session } = makeRenderer();
    renderer.start();
    renderer.onSnapshot(
      baseSnapshot({
        status: "waiting_for_approval",
        waitingForApproval: { stepKey: "review-gate", reason: "external check", validation: "external" },
      }),
      [],
    );

    renderer.handleKey({ name: "r" });

    expect(session.calls).toEqual([{ method: "resume", stepKey: "review-gate", metadata: { actor: "cli", source: "tui" } }]);

    renderer.stop();
  });

  it("surfaces a failed approve outcome as a status message in the frame", () => {
    const session = new FakeSession();
    session.approveResult = { ok: false, reason: "nothing waiting" };
    const { renderer } = makeRenderer({ session });
    renderer.start();
    renderer.onSnapshot(
      baseSnapshot({
        status: "waiting_for_approval",
        waitingForApproval: { stepKey: "review-gate", reason: "manual sign-off", validation: "human" },
      }),
      [],
    );

    renderer.handleKey({ name: "a" });

    // The approval banner takes render priority over the transient status
    // message while a wait is still pending locally; once a follow-up
    // snapshot clears it (e.g. the engine already moved on independently of
    // this failed call), the status message becomes visible.
    renderer.onSnapshot(baseSnapshot({ status: "running", waitingForApproval: null }), []);
    const joined = joinedRows(renderer.renderNow());
    expect(joined).toContain("approve failed: nothing waiting");

    renderer.stop();
  });
});

describe("TuiRunRenderer.handleKey — quit / cancel", () => {
  it("'q' cancels while the run is still active", () => {
    const { renderer, session } = makeRenderer();
    renderer.start();
    renderer.onSnapshot(baseSnapshot({ status: "running" }), []);

    renderer.handleKey({ name: "q" });

    expect(session.calls).toEqual([
      { method: "cancel", stepKey: undefined, metadata: { actor: "cli", source: "tui", note: "cancelled from TUI" } },
    ]);

    renderer.stop();
  });

  it("ctrl+c behaves like q", () => {
    const { renderer, session } = makeRenderer();
    renderer.start();
    renderer.onSnapshot(baseSnapshot({ status: "running" }), []);

    renderer.handleKey({ name: "c", ctrl: true });

    expect(session.calls).toEqual([
      { method: "cancel", stepKey: undefined, metadata: { actor: "cli", source: "tui", note: "cancelled from TUI" } },
    ]);

    renderer.stop();
  });

  it("'c' without a pending approval does not call session.cancel", () => {
    const { renderer, session } = makeRenderer();
    renderer.start();
    renderer.onSnapshot(baseSnapshot({ status: "running", waitingForApproval: null }), []);

    renderer.handleKey({ name: "c" });

    expect(session.calls).toEqual([]);
    const joined = joinedRows(renderer.renderNow());
    expect(joined).toContain("c cancels only a pending approval");

    renderer.stop();
  });
});
