# Agent-Authored Workflows (v0.8.0)

*2026-07-13*

v0.8.0 lets you author and validate `wfm` workflows collaboratively with a coding agent instead of hand-writing frontmatter from scratch. Describe a repeatable task in plain language, and the agent elicits success criteria, decomposes it into chronological steps, picks a quality gate per step, scaffolds the file, and validates it — then can drive the run and narrate progress back to you.

## What's new

- **Agent validation for steps** — `validation.mode: agent` runs a second agent call against a step's output and maps its verdict onto the engine's existing QA routing (`PROCEED`, `RETRY_CURRENT`, `ROLLBACK_PREVIOUS`, `RESTART_ALL`), so a step can be checked against phrased criteria (tests pass, diff stays in scope) without a human in the loop.
- **`attach-client` CLI + session-file handoff** — `wfm run <file> --session-file <path>` writes attach connection details as soon as a run starts and rewrites the file with the final status when it ends, so an agent can start a run in the background, poll it with `wfm status` / `wfm logs` / `wfm events`, and keep talking to you in between.
- **`wfm scaffold --template agent-validated`** — drops a three-step example workflow (agent-validated task → approval → finalize) as a starting point to edit in place.
- **Bundled `workflow-author` skill** — `wfm skill install workflow-author` installs the skill that teaches an agent the full authoring loop: eliciting criteria, decomposing steps, choosing gates, scaffolding, validating, dry-running, and narrating a run.
- **Skills embedded in compiled binaries** — bundled skills (including `workflow-author`) are now embedded directly into compiled binaries at build time, so `wfm skill install` works out of the box without a separate skills download.

Read the full guide at [Authoring Workflows With an Agent](/guide/authoring-with-an-agent) for the end-to-end loop, including the approval-gate schema gotcha and a worked session-file transcript.

## Also recent: Terminal UI (v0.7.0)

The previous release, v0.7.0, added a full-screen terminal UI for watching a run live: `wfm run <file> --ui` replaces the default scrolling output with a two-pane view — a step list on the left, streaming activity for the selected step on the right — with key bindings for approvals, resuming, and cancelling. See [Terminal UI](/guide/terminal-ui) for the layout and key bindings.

## Installing this version

```bash
npm install -g @workflow-manager/runner
```

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | bash
```

Both install paths now stay version-synced: when no version is pinned, the shell installer looks up the currently-published npm version and downloads the matching GitHub release asset, so `npm install -g @workflow-manager/runner` and the curl installer always resolve to the same build. See [Installing the CLI](/guide/installing) for the full set of environment overrides.
