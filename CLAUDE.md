# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See `AGENTS.md` for the full agent guide (branch/worktree policy, validation sequences, conventions). This file is the condensed version; when in doubt, AGENTS.md is authoritative.

## Commands

Runtime is Bun (dev + tests), TypeScript source, ESM output to `dist/`.

```bash
bun install                # setup (also installs git hooks via prepare)
bun run dev                # run the CLI from source (src/index.ts)
bun run lint               # biome lint (lint:fix applies safe fixes)
bun run build              # tsc build
bun test                   # full suite
bun run test:unit          # curated unit suite
bun run test:e2e           # story-workflow + opencode e2e
bun run test:e2e:real      # opt-in, requires opencode CLI (WORKFLOW_MANAGER_REAL_OPENCODE=1)
```

Single test: `bun test tests/parser.test.ts`, or one test name: `bun test tests/runnerCli.test.ts -t "prints usage for invalid input"`.

Sub-projects:

- Remote registry app (`apps/remote-registry/`, React + Vite): `bun run remote-registry:dev | :test | :build`; lint with `bun --cwd apps/remote-registry lint`. Read `apps/remote-registry/DESIGN.md` before UI work.
- Docs (`doc/`, VitePress): `bun run docs:dev | :build | :preview`.
- Supabase (`supabase/`, migrations + Edge Functions): `bun run supabase:start | :db:reset | :db:lint | :test | :stop`.

## Required validation before a task is done

In order: `bun run lint` → `bun test` (narrowest relevant subset first) → `bun run build`. If the change touches `apps/remote-registry/`, also `bun run remote-registry:test && bun run remote-registry:build`. If it touches `doc/` or user-facing CLI/schema, also `bun run docs:build`.

## Branch policy

Never commit directly to `main`. Non-trivial tasks get a worktree off freshly synced `main` at `~/Development/worktrees/workflow-manager/<MM-DD-YY>/<slug>` with branch `workflow-manager/<MM-DD-YY>/<slug>`, then `bun install` inside it. Trivial (<~5 line doc/typo) fixes still need a feature branch. Rebase onto `origin/main` before opening a PR; force-push feature branches only with `--force-with-lease`. Releases use Conventional Commits (release-please): `fix:` → patch, `feat:` → minor, `!`/`BREAKING CHANGE` → major.

## Agent delegation and model routing

Custom agents live in `.claude/agents/`. Policy: reasoning stays on the main model, code-writing goes to low-cost models.

- **Plan first, then delegate.** For non-trivial tasks, use `planner` (main model) to produce a task spec, then hand implementation steps to `implementer` (Sonnet) — in parallel waves when steps are independent. Do not write feature code in the main session when an implementer can do it from a clear spec.
- **`scout` (Haiku)** for codebase recon/search questions before planning; don't burn main-model tokens on file spelunking.
- **`test-writer` (Sonnet)** for test coverage after implementation.
- **`code-reviewer` (main model)** reviews the diff before anything is committed or a PR is opened.
- The main session's job is orchestration, judgment, and integration — trivial edits (<~5 lines) it may do directly.
- Model tiers are set via `model:` frontmatter in each agent file (`sonnet`/`haiku` for workers, `inherit` for reasoning roles so they track the main model). To pin a specific version, replace the alias with a full model ID (e.g. `claude-sonnet-5`).

## Architecture

`wfm` is a CLI workflow orchestrator: it parses workflow definitions (Markdown frontmatter or JSON), validates them, and executes steps through pluggable agent adapters, emitting a deterministic event timeline.

Execution pipeline (all in `src/`):

1. **`index.ts`** — CLI entrypoint and all commands (`doctor`, `agent`, `scaffold`, `validate`, `run`, `publish`, `pull`, `auth`, `approve`, `cancel`, ...). New commands need usage text here plus docs updates.
2. **`parser.ts`** — parses + validates both workflow formats. Required fields: `key`, `title`, `steps`. JSON and Markdown paths must stay at parity; normalize defaults in one place.
3. **`engine.ts`** — `runWorkflow(...)` is the orchestration center: dependency resolution (deterministic), approvals, retries, rollback/restart, and the event-driven snapshot/observer flow. Task execution is routed through executor functions, never inline adapter logic.
4. **Executors** — one per adapter: `piAgentExecutor.ts` (real default; drives the host `pi` coding agent CLI in print mode, with `input.json`/`output.json` envelopes in a run dir and `WFM_PI_INPUT_FILE`/`WFM_PI_OUTPUT_FILE` env vars for custom commands), `opencodeExecutor.ts` and `claudeCodeExecutor.ts` (opt-in real host paths), `mockExecutor.ts` (deterministic simulation; `codex` is mock-routed). Adapter keys live in `adapters.ts`.
5. **`runtimePreflight.ts`** — before `wfm run`, validates host requirements: adapter CLI binaries exist, and provider API keys (`OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) are present when the step model implies them.
6. **`runnerApi.ts` / `runnerSession.ts`** — every `wfm run` starts a local attach API on `127.0.0.1` (bearer token printed at start) serving run snapshots, logs, SSE events, and approve/resume/cancel endpoints. Contract in `doc/guide/runner-api.md`.
7. **`types.ts`** — shared domain contracts. Steps communicate via ATEP-like envelopes: `InputEnvelope` (global/step context + priming config) in, `OutputEnvelope` (execution status + QA routing action: `PROCEED`/`RETRY_CURRENT`/`ROLLBACK_PREVIOUS`/`RESTART_ALL`) out. Preserve `WorkflowDefinition`, `InputEnvelope`, `OutputEnvelope`, `RunResult`, and snapshot types; keep payloads JSON-serializable.

Around the CLI:

- **`skillResolver.ts` + `skills/`** — workflows reference local `SKILL.md` files; `publish` inlines skill markdown into `skills[*].content` with `contentSha256` integrity hashes; pulled workflows are rejected if declared skill content is missing.
- **Remote registry** — `wfm auth/search/publish/pull` talk to a Supabase-backed registry; its dashboard UI is `apps/remote-registry/`, backend migrations/Edge Functions in `supabase/`.

## Conventions that bite

- ESM everywhere; Node built-ins via `node:` prefix. Local imports in `src/` use `.js` extensions; tests import source via `.ts` paths.
- Strict TS; prefer `unknown` over `any`; reuse types from `src/types.ts` rather than parallel shapes.
- Ordinary user-input validation errors are returned as strings, not thrown; executor failures go through structured `OutputEnvelope`, not ad hoc exceptions.
- Step keys, workflow keys, and status strings are stable external identifiers — change cautiously; prefer additive, backward-compatible schema changes.
- Tests use `bun:test`; real external integrations stay opt-in behind env vars; cover both JSON and Markdown paths when touching format support.
- Biome formatting is disabled — match nearby style, avoid formatting churn.
- Don't commit `dist/` or generated binaries.
