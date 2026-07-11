import picocolors from "picocolors";
import type { QaAction, StepRunStatus, WorkflowRunStatus } from "../types.js";

export interface Theme {
  stepStatus(status: StepRunStatus, text: string): string;
  runStatus(status: WorkflowRunStatus, text: string): string;
  qaAction(action: QaAction, text: string): string;
  stepIcon(status: StepRunStatus): string;
  dim(text: string): string;
  bold(text: string): string;
  inverse(text: string): string;
  accent(text: string): string;
  stderrText(text: string): string;
}

// Icons stay plain text; callers color them via stepStatus so icon and label
// share one style. `satisfies` keeps the map exhaustive: a new StepRunStatus
// member fails the build here instead of rendering blank.
const STEP_ICONS = {
  pending: "·",
  runnable: "·",
  running: "▶",
  waiting_for_approval: "◌",
  succeeded: "✓",
  failed: "✗",
  cancelled: "✗",
} satisfies Record<StepRunStatus, string>;

type Styler = (text: string) => string;

// ANSI-16 palette only. createColors(false) yields identity formatters, so a
// disabled theme returns input text unchanged (tests rely on this).
export function createTheme(enableColor: boolean): Theme {
  const c = picocolors.createColors(enableColor);
  const dimGray: Styler = (text) => c.dim(c.gray(text));
  const dimRed: Styler = (text) => c.dim(c.red(text));

  const stepStyles = {
    pending: dimGray,
    runnable: dimGray,
    running: c.cyan,
    waiting_for_approval: c.yellow,
    succeeded: c.green,
    failed: c.red,
    cancelled: dimRed,
  } satisfies Record<StepRunStatus, Styler>;

  const runStyles = {
    queued: dimGray,
    running: c.cyan,
    waiting_for_approval: c.yellow,
    paused: c.yellow,
    succeeded: c.green,
    failed: c.red,
    cancelled: c.red,
  } satisfies Record<WorkflowRunStatus, Styler>;

  const qaStyles = {
    PROCEED: c.green,
    RETRY_CURRENT: c.yellow,
    ROLLBACK_PREVIOUS: c.magenta,
    RESTART_ALL: c.red,
  } satisfies Record<QaAction, Styler>;

  return {
    stepStatus: (status, text) => stepStyles[status](text),
    runStatus: (status, text) => runStyles[status](text),
    qaAction: (action, text) => qaStyles[action](text),
    stepIcon: (status) => STEP_ICONS[status],
    dim: (text) => c.dim(text),
    bold: (text) => c.bold(text),
    inverse: (text) => c.inverse(text),
    accent: (text) => c.cyan(text),
    stderrText: dimRed,
  };
}
