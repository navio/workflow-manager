import { describe, expect, it } from "bun:test";
import { stripAnsi } from "../src/tui/ansi.ts";
import { createTheme } from "../src/tui/theme.ts";
import type { QaAction, StepRunStatus, WorkflowRunStatus } from "../src/types.ts";

const STEP_STATUSES: StepRunStatus[] = [
  "pending",
  "runnable",
  "running",
  "waiting_for_approval",
  "succeeded",
  "failed",
  "cancelled",
];

const RUN_STATUSES: WorkflowRunStatus[] = [
  "queued",
  "running",
  "waiting_for_approval",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
];

const QA_ACTIONS: QaAction[] = ["PROCEED", "RETRY_CURRENT", "ROLLBACK_PREVIOUS", "RESTART_ALL"];

describe("createTheme(false)", () => {
  const theme = createTheme(false);

  it("applies identity styling for every step status", () => {
    for (const status of STEP_STATUSES) {
      expect(theme.stepStatus(status, "text")).toBe("text");
    }
  });

  it("applies identity styling for every run status", () => {
    for (const status of RUN_STATUSES) {
      expect(theme.runStatus(status, "text")).toBe("text");
    }
  });

  it("applies identity styling for every QA action", () => {
    for (const action of QA_ACTIONS) {
      expect(theme.qaAction(action, "text")).toBe("text");
    }
  });

  it("applies identity styling for text helpers", () => {
    expect(theme.dim("text")).toBe("text");
    expect(theme.bold("text")).toBe("text");
    expect(theme.inverse("text")).toBe("text");
    expect(theme.accent("text")).toBe("text");
    expect(theme.stderrText("text")).toBe("text");
  });
});

describe("createTheme(true)", () => {
  const theme = createTheme(true);

  it("styles every step status with escape codes that strip back to the input", () => {
    for (const status of STEP_STATUSES) {
      const styled = theme.stepStatus(status, "text");
      expect(styled).not.toBe("text");
      expect(styled.includes("\x1b[")).toBe(true);
      expect(stripAnsi(styled)).toBe("text");
    }
  });

  it("styles every run status with escape codes that strip back to the input", () => {
    for (const status of RUN_STATUSES) {
      const styled = theme.runStatus(status, "text");
      expect(styled).not.toBe("text");
      expect(styled.includes("\x1b[")).toBe(true);
      expect(stripAnsi(styled)).toBe("text");
    }
  });

  it("styles every QA action with a distinct color", () => {
    const seen = new Set<string>();
    for (const action of QA_ACTIONS) {
      const styled = theme.qaAction(action, "text");
      expect(styled).not.toBe("text");
      expect(stripAnsi(styled)).toBe("text");
      seen.add(styled);
    }
    expect(seen.size).toBe(QA_ACTIONS.length);
  });

  it("distinguishes the visually distinct step status groups", () => {
    const styled = (status: StepRunStatus) => theme.stepStatus(status, "text");
    // pending/runnable intentionally share dim gray.
    expect(styled("pending")).toBe(styled("runnable"));
    const groups = [
      styled("pending"),
      styled("running"),
      styled("waiting_for_approval"),
      styled("succeeded"),
      styled("failed"),
      styled("cancelled"),
    ];
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("styles text helpers distinctly from plain text", () => {
    for (const helper of ["dim", "bold", "inverse", "accent", "stderrText"] as const) {
      const styled = theme[helper]("text");
      expect(styled).not.toBe("text");
      expect(stripAnsi(styled)).toBe("text");
    }
  });

  it("maps every step status to the expected plain icon", () => {
    const expected: Record<StepRunStatus, string> = {
      pending: "·",
      runnable: "·",
      running: "▶",
      waiting_for_approval: "◌",
      succeeded: "✓",
      failed: "✗",
      cancelled: "✗",
    };
    for (const status of STEP_STATUSES) {
      const icon = theme.stepIcon(status);
      expect(icon).toBe(expected[status]);
      // Icons stay uncolored even when the theme has color enabled.
      expect(icon.includes("\x1b")).toBe(false);
    }
  });

  it("colors failed and cancelled icons differently through stepStatus", () => {
    expect(theme.stepIcon("failed")).toBe(theme.stepIcon("cancelled"));
    expect(theme.stepStatus("failed", "✗")).not.toBe(theme.stepStatus("cancelled", "✗"));
  });
});
