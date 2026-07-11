// Pure two-pane frame composer for `wfm run --ui`.
//
// renderFrame(state) is a plain function: given a TuiFrameState it returns an
// array of exactly `state.height` display rows, each at most `state.width`
// visible columns wide (ANSI-aware — see ansi.ts). No I/O, no timers, no
// Date.now(): every time-dependent value is derived from `state.now`, which
// callers refresh on their own render loop.
import { elapsedFrom, formatDurationMs } from "../runFormat.js";
import type { QaAction, RunSnapshot, StepDetailSnapshot, StepSnapshot } from "../types.js";
import { padVisible, truncateVisible, visibleWidth } from "./ansi.js";
import type { TuiLogStore } from "./logStore.js";
import type { Theme } from "./theme.js";

export interface TuiFrameState {
  snapshot: RunSnapshot | null;
  stepDetails: Map<string, StepDetailSnapshot>;
  logs: TuiLogStore;
  selectedStepKey: string | null;
  follow: boolean;
  attachUrl: string;
  attachToken: string;
  statusMessage?: string | null;
  width: number;
  height: number;
  now: number;
  theme: Theme;
}

// Below these thresholds the two-pane layout has no room to stay readable;
// fall back to a single-column stack instead of corrupting column math.
const DEGRADED_MIN_WIDTH = 60;
const DEGRADED_MIN_HEIGHT = 12;

// Fixed chrome rows around the variable-height content area: top border,
// attach-info row, pane-title separator, footer separator, two footer rows,
// bottom border.
const CHROME_ROWS = 7;

const KEY_HINTS = "↑/↓ select step   f follow current   a approve  r resume  c cancel  q quit";

const QA_ICONS: Record<QaAction, string> = {
  PROCEED: "✓",
  RETRY_CURRENT: "↻",
  ROLLBACK_PREVIOUS: "⤺",
  RESTART_ALL: "⟲",
};

export function renderFrame(state: TuiFrameState): string[] {
  if (state.width < DEGRADED_MIN_WIDTH || state.height < DEGRADED_MIN_HEIGHT) {
    return renderDegradedFrame(state);
  }
  return renderFullFrame(state);
}

// --- generic row-fitting helpers -------------------------------------------------

/** Truncates or right-pads `text` so visibleWidth(result) === width (never more). */
function fitExact(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w > width) {
    return truncateVisible(text, width);
  }
  if (w < width) {
    return padVisible(text, width);
  }
  return text;
}

/** Pads `text` with trailing box-drawing dashes up to `width` (truncates if it overflows). */
function fillDashes(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w >= width) {
    return truncateVisible(text, width);
  }
  return text + "─".repeat(width - w);
}

// --- full (non-degraded) frame ----------------------------------------------------

function renderFullFrame(state: TuiFrameState): string[] {
  const { width, height } = state;
  const contentRows = height - CHROME_ROWS;

  const paneLeftWidth = Math.min(38, Math.floor(width * 0.4));
  const paneRightWidth = width - 3 - paneLeftWidth;

  const rows: string[] = [];
  rows.push(buildTopBorder(state, width));
  rows.push(buildAttachRow(state, width));
  rows.push(buildPaneTitleRow(state, paneLeftWidth, paneRightWidth));

  const stepLines = buildStepPaneLines(state, paneLeftWidth, contentRows);
  const activityLines = buildActivityPaneLines(state, paneRightWidth, contentRows);
  for (let i = 0; i < contentRows; i++) {
    rows.push(`│${stepLines[i]}│${activityLines[i]}│`);
  }

  rows.push(`├${"─".repeat(paneLeftWidth)}┴${"─".repeat(paneRightWidth)}┤`);
  rows.push(buildFooterRow(width, buildApprovalOrStatusText(state)));
  rows.push(buildFooterRow(width, state.theme.dim(KEY_HINTS)));
  rows.push(`└${"─".repeat(width - 2)}┘`);

  return rows.map((row) => fitExact(row, width));
}

function buildTopBorder(state: TuiFrameState, width: number): string {
  const { snapshot, theme } = state;
  const title = snapshot?.workflowTitle ?? "wfm run";
  const statusSegment = snapshot
    ? theme.runStatus(snapshot.status, `● ${snapshot.status.replace(/_/g, " ")} · elapsed ${computeElapsed(snapshot, state.now)}`)
    : theme.dim("● initializing…");

  const left = `┌─ ${title} `;
  const right = ` ${statusSegment} ─┐`;
  const fill = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
  return left + "─".repeat(fill) + right;
}

function buildAttachRow(state: TuiFrameState, width: number): string {
  const { snapshot } = state;
  const tokenPreview = state.attachToken ? `${state.attachToken.slice(0, 8)}…` : "—";
  const runPreview = snapshot?.runId ? `${snapshot.runId.slice(0, 8)}…` : "—";

  const left = `│ Attach: ${state.attachUrl} (token ${tokenPreview})`;
  const right = `run ${runPreview} │`;
  const fill = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return left + " ".repeat(fill) + right;
}

function buildPaneTitleRow(state: TuiFrameState, paneLeftWidth: number, paneRightWidth: number): string {
  const { snapshot, selectedStepKey } = state;
  const steps = snapshot?.steps ?? [];
  const succeeded = steps.filter((s) => s.status === "succeeded").length;
  const leftTitle = ` Steps (${succeeded}/${steps.length} done) `;

  const selectedStep = selectedStepKey ? steps.find((s) => s.stepKey === selectedStepKey) : undefined;
  const rightTitle = selectedStep
    ? ` Activity: ${selectedStep.stepKey} · ${selectedStep.status.replace(/_/g, " ")} `
    : " Activity: (none) ";

  const leftSeg = fillDashes(leftTitle, paneLeftWidth);
  const rightSeg = fillDashes(rightTitle, paneRightWidth);
  return `├${leftSeg}┬${rightSeg}┤`;
}

function buildFooterRow(width: number, text: string): string {
  const inner = width - 2;
  const content = ` ${text}`;
  return `│${fitExact(content, inner)}│`;
}

function buildApprovalOrStatusText(state: TuiFrameState): string {
  const { snapshot, theme } = state;
  const waiting = snapshot?.waitingForApproval;
  if (waiting) {
    const actionHint = waiting.validation === "external" ? "[r]esume" : "[a]pprove";
    const text = `◌ ${waiting.stepKey} waiting for approval — ${actionHint}  [c]ancel`;
    return theme.runStatus("waiting_for_approval", text);
  }
  if (state.statusMessage) {
    return theme.dim(state.statusMessage);
  }
  return "";
}

// --- left pane: step list ----------------------------------------------------------

interface StepFlatItem {
  step: StepSnapshot;
  index1based: number;
  isBadge: boolean;
}

function buildStepPaneLines(state: TuiFrameState, paneLeftWidth: number, contentRows: number): string[] {
  const { snapshot, theme, selectedStepKey, stepDetails, now } = state;
  const steps = snapshot?.steps ?? [];

  const flatItems: StepFlatItem[] = [];
  steps.forEach((step, idx) => {
    const index1based = idx + 1;
    flatItems.push({ step, index1based, isBadge: false });
    const detail = stepDetails.get(step.stepKey);
    const qaAction = detail?.lastExecution.qaAction ?? null;
    const showBadge = step.attempt > 1 || (qaAction !== null && qaAction !== "PROCEED");
    if (showBadge) {
      flatItems.push({ step, index1based, isBadge: true });
    }
  });

  let windowStart = 0;
  if (flatItems.length > contentRows) {
    const selIdx = selectedStepKey
      ? flatItems.findIndex((item) => !item.isBadge && item.step.stepKey === selectedStepKey)
      : -1;
    if (selIdx >= 0) {
      windowStart = Math.min(Math.max(0, selIdx - Math.floor(contentRows / 2)), flatItems.length - contentRows);
    }
  }

  const lines: string[] = [];
  for (let i = 0; i < contentRows; i++) {
    const item = flatItems[windowStart + i];
    if (!item) {
      if (i === 0 && steps.length === 0 && !snapshot) {
        lines.push(fitExact(theme.dim(" Initializing…"), paneLeftWidth));
      } else {
        lines.push(padVisible("", paneLeftWidth));
      }
      continue;
    }
    const selected = !item.isBadge && item.step.stepKey === selectedStepKey;
    lines.push(
      item.isBadge
        ? buildBadgeLine(item, paneLeftWidth, theme, stepDetails)
        : buildStepLine(item, paneLeftWidth, theme, selected, now),
    );
  }
  return lines;
}

function buildStepLine(
  item: StepFlatItem,
  paneLeftWidth: number,
  theme: Theme,
  selected: boolean,
  now: number,
): string {
  const { step, index1based } = item;
  const icon = theme.stepIcon(step.status);
  const duration = stepDuration(step, now);
  const raw = `${icon} ${index1based} ${step.stepKey} ${step.adapter} ${duration}`.trimEnd();
  const fitted = fitExact(raw, paneLeftWidth);
  return selected ? theme.inverse(fitted) : theme.stepStatus(step.status, fitted);
}

function buildBadgeLine(
  item: StepFlatItem,
  paneLeftWidth: number,
  theme: Theme,
  stepDetails: Map<string, StepDetailSnapshot>,
): string {
  const { step } = item;
  const detail = stepDetails.get(step.stepKey);
  const parts: string[] = [];
  if (step.attempt > 1) {
    parts.push(theme.dim(`attempt ${step.attempt}`));
  }
  const qaAction = detail?.lastExecution.qaAction ?? null;
  if (qaAction && qaAction !== "PROCEED") {
    parts.push(theme.qaAction(qaAction, `${QA_ICONS[qaAction]} ${qaAction}`));
  }
  const raw = `    ${parts.join(" · ")}`;
  return fitExact(raw, paneLeftWidth);
}

function stepDuration(step: StepSnapshot, now: number): string {
  if (step.startedAt && step.finishedAt) {
    return formatDurationMs(Date.parse(step.finishedAt) - Date.parse(step.startedAt));
  }
  if (step.startedAt && step.status === "running") {
    return elapsedFrom(step.startedAt, now);
  }
  return "";
}

function computeElapsed(snapshot: RunSnapshot, now: number): string {
  if (!snapshot.startedAt) {
    return "0s";
  }
  const endTs = snapshot.endedAt ? Date.parse(snapshot.endedAt) : now;
  return elapsedFrom(snapshot.startedAt, endTs);
}

// --- right pane: activity log --------------------------------------------------

function buildActivityPaneLines(state: TuiFrameState, paneRightWidth: number, contentRows: number): string[] {
  const { logs, selectedStepKey, theme } = state;
  const lines = selectedStepKey ? logs.tail(selectedStepKey, contentRows) : [];

  const rendered: string[] = [];
  for (let i = 0; i < contentRows; i++) {
    const line = lines[i];
    if (!line) {
      rendered.push(padVisible("", paneRightWidth));
      continue;
    }
    const raw = line.kind === "meta" ? `▸ ${line.text}` : line.text;
    const truncated = truncateVisible(raw, paneRightWidth);
    const colored = line.kind === "stderr" ? theme.stderrText(truncated) : line.kind === "meta" ? theme.accent(truncated) : truncated;
    rendered.push(padVisible(colored, paneRightWidth));
  }
  return rendered;
}

// --- degraded (narrow/short terminal) frame ----------------------------------------

function renderDegradedFrame(state: TuiFrameState): string[] {
  const { snapshot, theme, width, height, selectedStepKey, now } = state;
  const rows: string[] = [];

  const title = snapshot?.workflowTitle ?? "wfm run";
  const statusWord = snapshot ? snapshot.status.replace(/_/g, " ") : "initializing";
  const headerText = snapshot ? theme.runStatus(snapshot.status, `${title} — ${statusWord}`) : theme.dim(`${title} — ${statusWord}`);
  rows.push(fitExact(headerText, width));

  const steps = snapshot?.steps ?? [];
  const stepRowBudget = Math.max(0, height - 1);
  for (let i = 0; i < stepRowBudget; i++) {
    const step = steps[i];
    if (!step) {
      rows.push(padVisible("", width));
      continue;
    }
    const icon = theme.stepIcon(step.status);
    const duration = stepDuration(step, now);
    const raw = `${icon} ${i + 1} ${step.stepKey} ${step.adapter} ${duration}`.trimEnd();
    const selected = step.stepKey === selectedStepKey;
    const fitted = fitExact(raw, width);
    rows.push(selected ? theme.inverse(fitted) : theme.stepStatus(step.status, fitted));
  }

  return rows.slice(0, height);
}
