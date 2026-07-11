import { describe, expect, it } from "bun:test";
import { renderFrame } from "../src/tui/layout.ts";
import type { TuiFrameState } from "../src/tui/layout.ts";
import { stripAnsi, visibleWidth } from "../src/tui/ansi.ts";
import { TuiLogStore } from "../src/tui/logStore.ts";
import { createTheme } from "../src/tui/theme.ts";
import type { RunSnapshot, StepDetailSnapshot, StepSnapshot } from "../src/types.ts";

const NOW = Date.parse("2026-07-10T12:05:00.000Z");

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
      step({
        stepKey: "implement",
        status: "running",
        attempt: 2,
        adapter: "claude-code",
        startedAt: "2026-07-10T12:04:19.000Z",
      }),
      step({ stepKey: "review-gate", status: "waiting_for_approval", adapter: "approval" }),
      step({ stepKey: "release", status: "pending", adapter: "opencode" }),
    ],
    ...overrides,
  };
}

function baseStepDetails(): Map<string, StepDetailSnapshot> {
  const map = new Map<string, StepDetailSnapshot>();
  map.set("implement", {
    stepKey: "implement",
    status: "running",
    attempt: 2,
    confirmed: false,
    adapter: "claude-code",
    startedAt: "2026-07-10T12:04:19.000Z",
    updatedAt: "2026-07-10T12:04:59.000Z",
    finishedAt: null,
    kind: "task",
    objective: "Implement the feature",
    dependsOn: ["plan"],
    config: { model: null, skills: [], mcps: [], systemPrompts: [], contextSummary: { type: "none" } },
    lastExecution: {
      executionStatus: "QA_REJECTED",
      qaAction: "RETRY_CURRENT",
      feedbackReason: "tests flaky",
    },
  });
  return map;
}

function baseLogs(): TuiLogStore {
  const store = new TuiLogStore();
  store.appendMeta("implement", "agent started: pi -p … model=opus");
  store.appendChunk({
    id: "1",
    runId: "run-1",
    stepKey: "implement",
    stream: "stdout",
    text: "Writing src/feature.ts\n",
    occurredAt: "2026-07-10T12:04:20.000Z",
  });
  store.appendChunk({
    id: "2",
    runId: "run-1",
    stepKey: "implement",
    stream: "stderr",
    text: "warn: 2 lint issues auto-fixed\n",
    occurredAt: "2026-07-10T12:04:30.000Z",
  });
  store.appendMeta("implement", "execution finished: QA_REJECTED action=RETRY_CURRENT reason=tests flaky");
  return store;
}

function baseState(overrides: Partial<TuiFrameState> = {}): TuiFrameState {
  return {
    snapshot: baseSnapshot(),
    stepDetails: baseStepDetails(),
    logs: baseLogs(),
    selectedStepKey: "implement",
    follow: true,
    attachUrl: "http://127.0.0.1:61233",
    attachToken: "3f9c11a2b3c4d5e6",
    statusMessage: null,
    width: 80,
    height: 24,
    now: NOW,
    theme: createTheme(false),
    ...overrides,
  };
}

const SIZES: Array<{ width: number; height: number; label: string }> = [
  { width: 80, height: 24, label: "80x24" },
  { width: 120, height: 40, label: "120x40" },
  { width: 60, height: 15, label: "60x15" },
  { width: 40, height: 10, label: "40x10 degraded" },
];

describe("renderFrame — dimensions", () => {
  for (const { width, height, label } of SIZES) {
    it(`returns exactly height rows for ${label}`, () => {
      const frame = renderFrame(baseState({ width, height }));
      expect(frame.length).toBe(height);
    });

    it(`keeps every row within width for ${label}`, () => {
      const frame = renderFrame(baseState({ width, height }));
      for (const row of frame) {
        expect(visibleWidth(row)).toBeLessThanOrEqual(width);
      }
    });

    it(`keeps every row within width for ${label} with colors enabled`, () => {
      const frame = renderFrame(baseState({ width, height, theme: createTheme(true) }));
      expect(frame.length).toBe(height);
      for (const row of frame) {
        expect(visibleWidth(row)).toBeLessThanOrEqual(width);
      }
    });
  }
});

describe("renderFrame — content", () => {
  it("includes workflow title, run status word, and attach info", () => {
    const frame = renderFrame(baseState());
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("Story Pipeline");
    expect(joined).toContain("running");
    expect(joined).toContain("http://127.0.0.1:61233");
    expect(joined).toContain("3f9c11a2");
  });

  it("shows steps progress and every step key with its adapter", () => {
    const frame = renderFrame(baseState());
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("2/5 done");
    for (const key of ["discover", "plan", "implement", "review-gate", "release"]) {
      expect(joined).toContain(key);
    }
    expect(joined).toContain("mock");
    expect(joined).toContain("claude-code");
    expect(joined).toContain("opencode");
    expect(joined).toContain("approval");
  });

  it("shows the retry badge with attempt count and QA action", () => {
    const frame = renderFrame(baseState());
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("attempt 2");
    expect(joined).toContain("RETRY_CURRENT");
  });

  it("renders the selected step's log tail in the activity pane", () => {
    const frame = renderFrame(baseState());
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("agent started: pi -p");
    expect(joined).toContain("Writing src/feature.ts");
    expect(joined).toContain("warn: 2 lint issues auto-fixed");
    expect(joined).toContain("execution finished: QA_REJECTED");
  });

  it("shows the approval banner with [a]pprove for human validation", () => {
    const snapshot = baseSnapshot({
      waitingForApproval: {
        stepKey: "review-gate",
        reason: "manual sign-off required",
        validation: "human",
        preview: {
          stepLabel: "Review gate",
          objective: "Confirm release readiness",
          summary: "All checks green",
          items: [{ stepKey: "review-gate", title: "Review gate", summary: "All checks green", source: "current_step" }],
        },
      },
    });
    const frame = renderFrame(baseState({ snapshot }));
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("waiting for approval");
    expect(joined).toContain("[a]pprove");
  });

  it("switches to [r]esume for external validation", () => {
    const snapshot = baseSnapshot({
      waitingForApproval: {
        stepKey: "review-gate",
        reason: "external check pending",
        validation: "external",
        preview: null,
      },
    });
    const frame = renderFrame(baseState({ snapshot }));
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("[r]esume");
    expect(joined).not.toContain("[a]pprove");
  });

  it("always renders the key hints row", () => {
    const frame = renderFrame(baseState());
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("↑/↓ select step");
    expect(joined).toContain("f follow current");
    expect(joined).toContain("a approve");
    expect(joined).toContain("r resume");
    expect(joined).toContain("c cancel");
    expect(joined).toContain("q quit");
  });

  it("shows a transient status message when set and no approval is pending", () => {
    const frame = renderFrame(baseState({ statusMessage: "approve failed: network error" }));
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("approve failed: network error");
  });
});

describe("renderFrame — selection", () => {
  it("renders a different frame when the selected step changes", () => {
    const frameA = renderFrame(baseState({ selectedStepKey: "implement" }));
    const frameB = renderFrame(baseState({ selectedStepKey: "discover" }));
    expect(frameA).not.toEqual(frameB);
  });

  it("keeps an offscreen selected step visible via scrolling", () => {
    const steps: StepSnapshot[] = [];
    for (let i = 1; i <= 12; i++) {
      steps.push(step({ stepKey: `step-${i}`, status: i < 9 ? "succeeded" : "pending" }));
    }
    const snapshot = baseSnapshot({ steps, currentStepKey: "step-9" });
    // height 15 -> contentRows = 15 - 7 = 8, so a naive top-N window would
    // never reach the 9th (index 8) step without scroll-to-selection logic.
    const frame = renderFrame(
      baseState({ snapshot, stepDetails: new Map(), selectedStepKey: "step-9", width: 80, height: 15 }),
    );
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("step-9");
  });
});

describe("renderFrame — null snapshot", () => {
  it("renders an initializing frame at the exact requested size", () => {
    const frame = renderFrame(baseState({ snapshot: null, selectedStepKey: null, stepDetails: new Map() }));
    expect(frame.length).toBe(24);
    for (const row of frame) {
      expect(visibleWidth(row)).toBeLessThanOrEqual(80);
    }
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("wfm run");
  });

  it("never throws for a null snapshot at degraded sizes", () => {
    expect(() => renderFrame(baseState({ snapshot: null, selectedStepKey: null, width: 40, height: 10 }))).not.toThrow();
  });
});

describe("renderFrame — degradation", () => {
  it("drops to a stacked view below the width/height thresholds without throwing", () => {
    expect(() => renderFrame(baseState({ width: 40, height: 10 }))).not.toThrow();
    const frame = renderFrame(baseState({ width: 40, height: 10 }));
    expect(frame.length).toBe(10);
    for (const row of frame) {
      expect(visibleWidth(row)).toBeLessThanOrEqual(40);
    }
  });

  it("still shows the workflow title in the degraded header", () => {
    const frame = renderFrame(baseState({ width: 40, height: 10 }));
    const joined = frame.map(stripAnsi).join("\n");
    expect(joined).toContain("Story Pipeline");
  });
});
