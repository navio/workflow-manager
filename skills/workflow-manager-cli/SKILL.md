---
name: workflow-manager-cli
description: >
  Load this skill when working with the wfm CLI from @workflow-manager/runner:
  authoring, validating, or running workflow definitions, configuring adapters
  and step skills, controlling runs through the attach API, or publishing
  workflows to the remote registry. Covers doctor, skill, scaffold, validate,
  run, approve, resume, cancel, auth, publish, pull, search, and remote info.
type: core
library: "@workflow-manager/runner"
sources:
  - "navio/workflow-manager:README.md"
  - "navio/workflow-manager:src/index.ts"
  - "navio/workflow-manager:src/parser.ts"
  - "navio/workflow-manager:src/engine.ts"
  - "navio/workflow-manager:src/runtimePreflight.ts"
  - "navio/workflow-manager:src/skillResolver.ts"
  - "navio/workflow-manager:src/remote/commands.ts"
  - "navio/workflow-manager:doc/guide/runner-api.md"
---

# wfm CLI

`wfm` (also installed as `workflow-manager`) parses a workflow definition file (Markdown frontmatter or JSON), validates it, and executes its steps through pluggable agent adapters with deterministic dependency ordering, approvals, retries, and rollback routing.

## Core flow

Follow this sequence unless the user asks for a narrower task:

1. `wfm doctor` — inspect host adapter binaries and provider API keys.
2. `wfm scaffold ./workflow.md` (or `--format json`) — generate a starter definition.
3. Edit step keys, objectives, `dependsOn`, validation modes, and `taskSpec.init`.
4. `wfm validate ./workflow.md` — always validate before running or publishing.
5. `wfm doctor ./workflow.md` — preflight the specific workflow before real adapter runs.
6. `wfm run ./workflow.md` — execute with live progress; add `--verbose` for agent output.
7. `wfm publish ./workflow.md` — only after validation succeeds.

## Command reference

```bash
wfm doctor [workflow] [--json]        # host + per-workflow preflight checks
wfm skill list                        # list skills bundled with the npm package
wfm skill install [name ...]          # install bundled skills for an agent (see below)
wfm scaffold [path] [--format markdown|json]
wfm validate <workflow>
wfm run <workflow> [--input input.json] [--objective "text"] [--confirm stepA,stepB:human] [--auto-confirm-all] [--port 43121] [--verbose] [--json]
wfm approve|resume|cancel [--url ...] [--token ...] [--run-id ...] [--step ...] [--actor ...] [--note ...]
wfm auth <login|whoami|logout> [--token <token>]
wfm publish <workflow> [--slug s] [--title t] [--description d] [--visibility public|private] [--version v] [--tag a,b] [--draft]
wfm pull <owner/slug> [--version v] [--output path]
wfm search [query]
wfm remote info <owner/slug>
wfm man
```

Exit codes: `0` success, `1` validation or runtime error, `2` run finished in a non-success terminal status.

## Host configuration

Adapters (set per step via `taskSpec.adapterKey`; omit for the default):

| Adapter | Kind | Notes |
| --- | --- | --- |
| `pi-agent` | real (default) | Drives the host `pi` coding agent CLI in print mode. `pi` must be on `PATH`; its auth lives in `~/.pi`, not env vars. |
| `opencode` | real (opt-in) | Requires the `opencode` CLI on `PATH`. |
| `claude-code` | real (opt-in) | Requires the `claude` CLI on `PATH`. |
| `codex` | mock-routed | Deterministic simulation. |
| `mock` | mock | Deterministic simulation for tests and examples. |

Provider API keys are inferred from `taskSpec.init.model` and checked by `wfm doctor` / run preflight:

- `openrouter/...` → `OPENROUTER_API_KEY`
- `openai/...`, `gpt-...` → `OPENAI_API_KEY`
- `anthropic/...`, `claude-...` → `ANTHROPIC_API_KEY`

Steps can also declare extra required env vars in `taskSpec.payload.requiredEnv`.

For custom `pi-agent` commands, the run directory exposes `input.json` / `output.json` envelopes through the `WFM_PI_INPUT_FILE` and `WFM_PI_OUTPUT_FILE` env vars.

## Workflow anatomy

Both formats describe the same schema; Markdown holds it in YAML frontmatter (body text is free-form notes), JSON holds it directly. Required top-level fields: `key`, `title`, `steps`. Optional: `description`, `objectives`, `inputSchema`, `outputSchema`, `defaultRetryPolicy`, `skills`.

```yaml
---
key: my-workflow                # stable external identifier — change cautiously
title: My Workflow
objectives: [deliver a working implementation]
defaultRetryPolicy:
  maxAttempts: 2
steps:
  - key: discover               # stable step key
    kind: task                  # task | approval
    objective: Understand requirements and constraints
    dependsOn: []
    validation:                 # mode: none | human | external
      mode: human
      required: true
      autoConfirm: false
    taskSpec:
      # adapterKey omitted -> pi-agent
      init:
        context: { repo: example/repo }
        skills: [architecture, planning]      # resolved step skills, see below
        mcps: [mcp://github]
        systemPrompts: [Focus on architecture trade-offs]
        model: openrouter/anthropic/claude-sonnet-4
      payload: {}
  - key: qa_gate
    kind: approval              # human checkpoint, no adapter
    dependsOn: [discover]
    approvalSpec:
      autoApprove: false
      validation: { mode: human, required: true, autoConfirm: false }
---
```

Authoring rules:

- Workflow keys, step keys, and status strings are stable external identifiers; prefer additive, backward-compatible changes.
- Make `dependsOn` explicit; the engine resolves dependencies deterministically and rejects cycles.
- Keep validation modes explicit per step. `human` pauses for approval (inline terminal prompt or attach API); `external` expects an outside system to resume the run.
- Use `adapterKey: mock` for deterministic examples and tests; use Markdown when humans will review notes, JSON for machine-generated definitions.

Steps communicate via ATEP-like envelopes: an `InputEnvelope` (global/step context plus priming config) goes in, an `OutputEnvelope` comes out carrying execution status and a QA routing action — `PROCEED`, `RETRY_CURRENT`, `ROLLBACK_PREVIOUS`, or `RESTART_ALL` — which the engine uses to advance, retry, roll back, or restart the run.

## Step skills

`taskSpec.init.skills` names are resolved per step in this order:

1. Embedded `skills.<name>.content` in the workflow file (how published workflows ship skills).
2. `skills.<name>.source` — a relative path that must match `skills/**/SKILL.md` under the workflow directory.
3. `<workflow-dir>/skills/<name>/SKILL.md` (project-local).
4. `~/.workflow-manager/skills/<name>/SKILL.md` (user-global).
5. The npm-packaged skills under `node_modules`.

`wfm publish` inlines resolved skill markdown into `skills[*].content` with a `contentSha256` integrity hash; pulled workflows are rejected when declared skill content is missing or tampered.

## Running and controlling runs

`wfm run` shows live progress on stderr and starts a local attach API on `127.0.0.1` for the lifetime of the run (OS-assigned port, or `--port`). The base URL and a per-run bearer token are printed to stderr before execution starts; every endpoint except `/health` requires `Authorization: Bearer <token>`. The API serves the session (`/session`), run snapshots, per-step detail, logs, an SSE event stream, and approve/resume/cancel endpoints (contract: `doc/guide/runner-api.md`).

- Interactive human approvals show an inline terminal prompt; non-interactive waits are resolved via `wfm approve` / `wfm resume` / `wfm cancel` using the printed URL and token.
- `--confirm stepA,stepB:human` pre-supplies confirmations for specific steps.
- Never use `--auto-confirm-all` unless the workflow is intentionally non-interactive — it bypasses every approval gate.
- `--json` prints the final result (including a `session` object) on stdout while progress stays on stderr.
- `--input input.json` merges a JSON file into global input state; `--objective` overrides the run objective.

## Remote registry

```bash
wfm auth login --token <token>     # token created in the registry web app
wfm auth whoami
wfm search <query>
wfm remote info <owner/slug>
wfm publish ./workflow.md --visibility public --tag automation
wfm pull <owner/slug> --output ./pulled-workflow.json
```

If `publish` fails, check login state with `wfm auth whoami`. Preserve the author's source format when publishing.

## Installing these skills for agents

`wfm skill install` copies bundled skills into an agent's skill directory so the agent loads this guidance on demand:

```bash
wfm skill list                                   # see what ships with the package
wfm skill install                                # workflow-manager-cli -> ./.claude/skills/
wfm skill install --global                       # -> ~/.claude/skills/
wfm skill install --agent opencode               # -> ./.opencode/skill/
wfm skill install --all --force                  # every bundled skill, overwrite existing
wfm skill install doc-sync --dir ./my/skills     # any other destination
```

## Troubleshooting

- Validation failure: fix the reported schema or dependency-cycle error before re-running; ordinary input errors are reported as messages, not stack traces.
- `doctor` failure for a real adapter: install the missing CLI (`pi`, `opencode`, `claude`) or export the missing provider API key.
- Run stuck `waiting_for_approval`: approve inline in the terminal, or use `wfm approve` with the attach URL/token printed at run start.
- Non-zero exit `2`: the run completed but not successfully — re-run with `--json` or `--verbose` to inspect step output.
- Publish/pull failures: verify `wfm auth whoami`; for skill integrity errors, confirm the declared skill files exist and match their `contentSha256`.
