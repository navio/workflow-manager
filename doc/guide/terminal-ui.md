# Terminal UI

`wfm run <file> --ui` replaces the default scrolling progress output with a full-screen, two-pane terminal UI: a live step list on the left and a streaming activity view for the selected step on the right.

## When to use it

Use `--ui` for workflows you're actively watching — long-running or multi-step runs where you want to see which step is active, jump between steps to inspect their output, and handle approvals without losing the run's history in scrollback. For unattended runs (CI, scripts, piped output) stick with the default renderer or `--json`.

## Launching it

```bash
wfm run ./example-workflow.md --ui
```

`--ui` composes with the other `run` flags, for example:

```bash
wfm run ./example-workflow.md --ui --confirm discover,qa_gate:human
wfm run ./example-workflow.md --ui --port 43121
```

## Layout

```text
┌─ Example Workflow ─────────────────── ● running · elapsed 12s ─┐
│ Attach: http://127.0.0.1:43121 (token 3b8c1a2f…)   run 9f21c0…│
├─ Steps (1/4 done) ──────┬─ Activity: discover · running ───────┤
│▶ 2 discover pi-agent 4s │ agent stdout and stderr for the      │
│    ↻ RETRY_CURRENT      │ selected step streams here, newest   │
│✓ 1 plan pi-agent 3s     │ lines at the bottom.                 │
│· 3 qa_gate mock         │ ▸ agent started: pi --model ...      │
│· 4 render pi-agent      │ ▸ execution finished: succeeded      │
├──────────────────────────┴───────────────────────────────────┤
│ ◌ qa_gate waiting for approval — [a]pprove  [c]ancel           │
│ ↑/↓ select step   f follow current   a approve  r resume  c…  │
└──────────────────────────────────────────────────────────────┘
```

The header shows the workflow title, run status, elapsed time, the attach API base URL and a truncated token prefix, and a truncated run id.

The left pane lists every step with a status icon and color, its 1-based index, step key, adapter, and live duration:

| Icon | Meaning | Color |
| --- | --- | --- |
| `·` | pending / runnable | dim |
| `▶` | running | cyan |
| `◌` | waiting for approval | yellow |
| `✓` | succeeded | green |
| `✗` | failed / cancelled | red |

When a step's attempt count is greater than 1, or its last QA action wasn't `PROCEED`, a badge line appears beneath it: `↻ RETRY_CURRENT` (yellow), `⤺ ROLLBACK_PREVIOUS` (magenta), or `⟲ RESTART_ALL` (red). The selected step is drawn in inverse video.

The right pane streams the selected step's live activity: stdout, stderr (dim red), and `▸`-prefixed meta lines for events like agent start/finish and execution results.

On terminals too small for the two-pane layout, the TUI falls back to a single-column stacked view of the header and step list.

## Key bindings

| Key | Action |
| --- | --- |
| `↑` / `k` | Select the previous step (disables follow) |
| `↓` / `j` | Select the next step (disables follow) |
| `f` | Re-follow the currently executing step |
| `a` | Approve the step waiting for human approval |
| `r` | Resume a step waiting on external validation |
| `c` | Cancel a step waiting for approval |
| `q` / `Ctrl-C` | Cancel the run (if still active) and quit |

Selecting a step with `↑`/`↓`/`j`/`k` turns off "follow" mode, so the right pane keeps showing whatever step you picked even as execution moves on. Press `f` to jump back to following the currently executing step.

## Approvals in the TUI

When a step is waiting, the footer shows an approval banner naming the step and the applicable action:

- Human validation (`validation: human`) steps show `[a]pprove [c]ancel`; press `a` to approve or `c` to cancel.
- External validation (`validation: external`) steps show `[r]esume` instead — press `r` to resume once the external condition is satisfied, or `c` to cancel. Pressing `a` on an external step shows a status message telling you to press `r` instead.
- `q` cancels the whole run (not just the pending approval) and quits, once the run is no longer terminal.

These key presses call the same session controls used everywhere else, so approvals aren't exclusive to the TUI: you can resolve the same waiting step concurrently with `wfm approve`, `wfm resume`, or `wfm cancel` pointed at the run's attach API, or by calling the attach API's `approve`/`resume`/`cancel` endpoints directly. Whichever resolves the step first wins, and the TUI reflects the outcome on its next redraw. See [Runner API](/guide/runner-api) for the attach API contract and CLI control commands.

## Non-TTY fallback and `--json`

`--ui` requires an interactive terminal on both stdin and stdout. If either isn't a TTY (piped output, CI, non-interactive shells), `wfm run` prints:

```text
⚠ --ui requires an interactive terminal; falling back to standard output
```

and the run proceeds exactly as it would without `--ui` — same renderer, same approval prompts, same output.

`--ui --json` is supported: the full-screen frames render to the terminal's alternate screen buffer as usual, and once the run finishes and the TUI tears down, the final JSON result is printed to stdout — so scripts that pipe `--json` output elsewhere still get clean JSON with no TUI escape codes mixed in.

## Colors

The TUI uses the same ANSI-16 color palette and `picocolors` detection as the rest of the CLI, so it honors `NO_COLOR` (disables color) and `FORCE_COLOR` (forces color even when output isn't detected as a color-capable terminal). With color disabled, status and icons still render — just without ANSI styling.
