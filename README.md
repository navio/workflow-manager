# workflow-manager

**wfm** (workflow-manager) is a CLI orchestrator that runs multi-step workflows where the steps are executed by AI coding agents, with human approval gates in between. You define a workflow in a Markdown (YAML frontmatter) or JSON file, and `wfm run` executes it step by step — think of it as a CI pipeline for AI agents: declarative multi-agent orchestration with QA routing, approval gates, and a sharing registry, run from a single binary.

The core ideas:

- **Workflow definitions.** A workflow is a list of steps with stable keys, objectives, and `dependsOn` edges (the engine topologically orders them). Each step is one of three kinds: `task` (delegated to an agent), `approval` (a human checkpoint), or `system`. Steps can carry retry policies, timeouts, and validation rules (`human`, `external`, or `none`).
- **Agent adapters.** Each task step picks an adapter that does the actual work: `pi-agent` (the default — drives the `pi` coding agent CLI with a built prompt plus `input.json`/`output.json` envelopes), `acp` (connects to any [Agent Client Protocol](https://agentclientprotocol.com) agent over JSON-RPC/stdio), and `mock` (deterministic simulator for tests/authoring). The `claude-code`, `opencode`, and `codex` keys are ACP presets — their original bespoke executors are deprecated behind `taskSpec.payload.legacyExecutor`. Steps can declare skills, MCP endpoints, system prompts, and a model under `taskSpec.init`, which get injected into the agent's prompt, input file, or ACP session.
- **The envelope protocol.** Every step execution returns a structured result: an execution status (`SUCCESS`, `FAILED`, `QA_REJECTED`, `YIELD_EXTERNAL`) plus a QA routing action (`PROCEED`, `RETRY_CURRENT`, `ROLLBACK_PREVIOUS`, `RESTART_ALL`). That's what lets the engine retry a step, roll back to the previous one, or restart the whole run based on what the agent reported.
- **Human-in-the-loop control.** While a run is active, wfm starts a local HTTP attach API (token-protected, with SSE event streaming), so a waiting step can be resolved either in the terminal prompt or from another shell with `wfm approve` / `wfm resume` / `wfm cancel`.
- **A registry.** `wfm publish` / `pull` / `search` / `auth` talk to a Supabase-backed remote registry (the `apps/remote-registry` web app in this repo) for sharing workflows, with skills bundled and SHA-256 verified. Runs also emit opt-in telemetry there.
- **Supporting commands.** `wfm scaffold` writes a starter workflow, `wfm validate` checks the schema and dependency cycles, `wfm doctor` verifies the host has the needed CLIs and API keys before a run, `wfm skill install` installs the bundled agent skills into Claude Code or opencode skill directories, and `wfm man` shows the man page.

Install the latest prebuilt CLI with:

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | bash
```

If `wfm` is not available immediately in the same terminal, run the shell reload command printed by the installer or open a new shell, then run `wfm --help`.

## What it does

- Parses workflow definitions from Markdown frontmatter or JSON
- Validates structure, dependencies, adapters, and validation modes
- Executes workflow steps with deterministic run state transitions
- Emits a full event timeline and JSON run result
- Starts a local attach API for live run snapshots and SSE events
- Records authenticated CLI run telemetry for success, failure, and workflow effectiveness
- Publishes and pulls shared workflows from the remote registry

## Architecture

- `src/index.ts`: CLI commands (`doctor`, `skill`, `scaffold`, `validate`, `run`)
- `src/parser.ts`: parsing + validation
- `src/engine.ts`: execution loop, confirmations, retries, rollback/restart
- `src/piAgentExecutor.ts`: default executor driving the `pi` coding agent CLI
- `src/mockExecutor.ts`: explicit mock step executor for simulation
- `src/events.ts`: event sequencing/logging
- `src/types.ts`: contracts and status enums
- `apps/remote-registry/`: React + Vite remote registry app
- `supabase/`: migrations, local stack config, and Edge Functions
- `doc/`: VitePress documentation site
- `skills/`: agent skills shipped inside the main npm package for TanStack Intent and compatible loaders

## Quick start

```bash
bun install
bun run build
bun link

wfm doctor
wfm skill install
wfm scaffold ./example-workflow.md
wfm validate ./example-workflow.md
wfm doctor ./example-workflow.md
wfm run ./example-workflow.md --auto-confirm-all
wfm run ./example-workflow.md --auto-confirm-all --verbose

# JSON workflow support
wfm scaffold ./example-workflow.json --format json
wfm validate ./example-workflow.json
wfm run ./example-workflow.json --auto-confirm-all

# Remote registry
wfm auth login --token <token>
wfm search bunny
wfm publish ./example-workflow.json --visibility public --tag storytelling,example
wfm pull alice/remote-bunny --output ./remote-bunny.json
```

Task steps run with the `pi-agent` adapter by default when `taskSpec.adapterKey` is omitted. The runner drives the [pi coding agent](https://github.com/earendil-works/pi-mono) CLI (`pi`) in non-interactive print mode: it builds a prompt from the step objective, workflow context, previous step output, and `taskSpec.init` context, and maps `taskSpec.init.model` to `--model`, each `taskSpec.init.systemPrompts` entry to `--append-system-prompt`, and each resolved skill to a `--skill` file written into the run directory. The full structured step input is also written to `input.json` in the run directory, and the agent is asked to write a result envelope to `output.json` for QA routing. If the agent exits successfully without writing one, the step succeeds and its response text becomes the step output. Set `WFM_PI_AGENT_COMMAND=/path/to/pi` to override the default `pi` binary, or set `taskSpec.payload.command` and `taskSpec.payload.args` for a specific step; custom commands receive the input/output file paths in the `WFM_PI_INPUT_FILE` and `WFM_PI_OUTPUT_FILE` environment variables (previous releases passed `--input`/`--output` flags instead). Use `adapterKey: mock` explicitly for deterministic simulation workflows.

Before execution starts, `wfm run` validates host runtime access for real adapters. Default `pi-agent` steps require the configured `pi` command to be installed and executable; pi manages provider credentials in its own auth store, so no API key environment variables are inferred for pi steps. Real `opencode` steps require the `opencode` CLI, and real `claude-code` steps require the `claude` CLI. For those adapters, if `taskSpec.init.model` or `taskSpec.payload.model` identifies a known provider, the matching key must also be present: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`. For custom clients, set `taskSpec.payload.requiredEnv` to the environment variable names that must exist before the run can start.

Use `wfm doctor` to inspect host adapter setup and `wfm doctor <workflow>` to validate a workflow's runtime requirements before running it. Today, `pi-agent` is the real default host adapter (driving the `pi` CLI), `mock` is a deterministic simulator, and `opencode`, `claude-code`, and `codex` have opt-in real paths through ACP (`useRealAdapter: true`). Codex routes through the `codex-acp` bridge — install it with `npm install -g @agentclientprotocol/codex-acp`; it reuses the codex CLI's own auth, so no API key environment variable is needed.

During `wfm run`, the CLI starts a local attach API on `127.0.0.1`. Use `--port <n>` to bind a fixed port or omit it to let the OS choose one. The CLI prints the attach base URL and bearer token before execution starts.

By default, `wfm run` now prints live workflow progress to stderr with the current step, elapsed workflow time, and remaining step count. Pass `--verbose` to stream per-step agent output chunks and execution status updates while the workflow is running. When a human approval is required in an interactive terminal, the CLI now prints an approval summary and prompts for approve or cancel inline. Pass `--ui` for a full-screen terminal UI with a live step list and per-step activity pane instead (falls back to standard output when stdin/stdout aren't an interactive terminal); see `doc/guide/terminal-ui.md`.

Runner API endpoints include:

- `GET /session`
- `GET /runs/:runId`
- `GET /runs/:runId/steps/:stepKey`
- `GET /runs/:runId/logs`
- `GET /runs/:runId/events` (SSE)
- `POST /runs/:runId/approve`
- `POST /runs/:runId/resume`
- `POST /runs/:runId/cancel`

Local control helpers are available too:

```bash
wfm approve --url http://127.0.0.1:43121 --token <token> --step review --actor alice --note "LGTM"
wfm cancel --url http://127.0.0.1:43121 --token <token> --step review --actor alice --note "stop this run"
```

See `doc/guide/runner-api.md` for the full contract.

Prefer the release binary instead of a source checkout:

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | bash
```

If `wfm` is not available immediately in the same terminal, run the shell reload command printed by the installer or open a new shell, then run `wfm --help`.

## Build

```bash
bun run lint
bun run build
bun test
```

Apply safe lint fixes:

```bash
bun run lint:fix
```

Build a standalone Bun binary:

```bash
bun run build:bin
```

Build all release binaries locally:

```bash
bun run build:bin:all
```

## Testing

Run unit tests:

```bash
bun run test:unit
```

Run the story workflow e2e tests (JSON and Markdown fixtures):

```bash
bun run test:e2e
```

The e2e suite also runs an `opencode` adapter variant for both JSON and Markdown workflows and asserts adapter routing in run events.

Run real OpenCode adapter e2e (requires `opencode` CLI installed):

```bash
bun run test:e2e:real
```

The real adapter test is opt-in and triggered by `WORKFLOW_MANAGER_REAL_OPENCODE=1`.

Run full test suite:

```bash
bun test
```

Documentation site:

```bash
bun run docs:dev
bun run docs:build
bun run docs:preview
```

Docs can be deployed from `doc/.vitepress/dist` locally, and GitHub Pages publishes them from `main` when files under `doc/` change.

Remote registry app:

```bash
bun run remote-registry:dev
bun --cwd apps/remote-registry lint
bun run remote-registry:test
bun run remote-registry:test:auth:local
bun run remote-registry:test:publish:local
bun run remote-registry:test:smoke:local
bun run remote-registry:build
```

Pre-commit hooks run staged-file linting automatically after `bun install` via the repo `prepare` script and `lint-staged`.

Supabase local validation:

```bash
bun run supabase:start
bun run supabase:db:reset
bun run supabase:db:lint
bun run supabase:test
bun run supabase:stop
```

GitHub Actions now owns the production Supabase release flow:

- `.github/workflows/supabase-validate.yml` validates `supabase/**` changes on pull requests
- `.github/workflows/supabase-release.yml` applies migrations and deploys Edge Functions after merge to `main`
- configure repository secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_ID`
`remote-registry:test:auth:local` is an opt-in live smoke that validates signup, email confirmation, signin, and password-reset email against a local Supabase stack (`supabase start`) and Mailpit (`http://127.0.0.1:54324`).
`remote-registry:test:publish:local` is an opt-in live smoke that validates handle claim and publish/search/pull owner-slug retrieval against the same local stack.

The docs site is published at `https://navio.github.io/workflow-manager/` via `.github/workflows/deploy-docs.yml`.

Manual help:

```bash
wfm man
```

Agent skills:

```bash
wfm skill list
wfm skill install
```

Remote registry commands:

```bash
wfm auth whoami
wfm auth logout
wfm remote info alice/remote-bunny
```

## Agent skills

The published `@workflow-manager/runner` npm package ships the CLI runner and the bundled agent skills together. The primary skill is `skills/workflow-manager-cli/SKILL.md`, which teaches an agent how to configure, author, run, and publish workflows with `wfm`.

### Let your agent build workflows

For a task that should run the same repeatable way every time, install the `workflow-author` skill (`wfm skill install workflow-author`) and describe the task to your coding agent instead of writing the workflow file by hand. The agent elicits success criteria, decomposes the task into steps with an explicit quality gate each (agent-validated, human-approved, or external), scaffolds and validates the file, then runs it with `--session-file` and narrates progress and approval gates back to you. See [`doc/guide/authoring-with-an-agent.md`](doc/guide/authoring-with-an-agent.md) for the full loop.

Install skills with the CLI:

```bash
wfm skill list                       # show bundled skills
wfm skill install                    # workflow-manager-cli -> ./.claude/skills/
wfm skill install --global           # -> ~/.claude/skills/
wfm skill install --agent opencode   # -> ./.opencode/skill/
wfm skill install --all              # install every bundled skill
wfm skill install doc-sync --dir ./my/skills
```

TanStack Intent discovery is also supported (package keyword `tanstack-intent`):

```bash
npm install @workflow-manager/runner
npx @tanstack/intent@latest list
npx @tanstack/intent@latest install
```

Workflow skill resolution now follows a local-authoring + portable-artifact model:

- authoring workflows can point to local skill files under `./skills/**/SKILL.md`
- `workflow-manager publish` inlines skill markdown into `skills[*].content`
- publish also writes `skills[*].contentSha256` for integrity checks
- pulled workflows are rejected if any declared skill is missing embedded content
- optional `skills[*].upstream` metadata can record source repo/ref/path for auditability

See `skills/README.md` for the packaged skill layout, TanStack Intent integration, and release checks.

The deployed registry dashboard also supports browser-based token creation, workflow publishing, and creator analytics.

Current dashboard capabilities include:

- creator workflow analytics
- analytics refresh and trend views
- authenticated CLI run telemetry insights
- token list and revoke controls
- browser-based workflow publishing for JSON and Markdown sources
- workflow metadata and version management

## Contribution

- Keep workflow contracts backward-compatible when possible (`src/types.ts`)
- Update docs under `doc/` when changing schema or runtime behavior
- Add or update tests in `tests/` when touching parser or engine logic

Netlify is reserved for `workflow-manager-ui`.

- build command: `bun run netlify:build`
- publish directory: `.netlify/deploy`
- `workflow-manager-ui` must set `NETLIFY_SITE_TARGET=remote-ui`

GitHub Pages is reserved for docs and only deploys on changes under `doc/`.

## Release

- Push a semantic tag like `v0.2.0` to trigger the GitHub Actions release workflow.
- Merges to `main` that change packaged CLI files (`src/`, `skills/`, `man/`, `package.json`, `tsconfig.json`) update the release PR maintained by `.github/workflows/release-please.yml`.
- Release Please uses Conventional Commit semantics to propose the next npm version: `fix:` -> patch, `feat:` -> minor, and `!` or `BREAKING CHANGE` -> major.
- Merging the Release Please PR bumps `package.json`, updates `CHANGELOG.md`, triggers `.github/workflows/npm-publish.yml` to publish `@workflow-manager/runner` to npm, and creates the release tag consumed by `.github/workflows/release.yml`.
- Docs, remote-registry, and other non-package changes do not trigger release automation.
- Configure the repository `NPM_TOKEN` secret with an npm automation token that can publish `@workflow-manager/runner`.
- Publish the root npm package when you want the CLI runner and `skills/` bundle to ship together.
- The workflow runs tests and build, then compiles binaries for:
  - macOS arm64: `wfm-macos-arm64`
  - Linux x64: `wfm-linux-x64`
  - Windows x64: `wfm-windows-x64.exe`
- Assets are attached to the GitHub Release for that tag.
- Each release also includes `workflow-manager-installer.sh`, so users can install `wfm` with `curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | bash`.

## Documentation

VitePress docs are in `doc/` and focus on:

- how the workflow manager works
- runtime architecture
- workflow schema
- practical workflow examples and implementation patterns
- CLI manual help usage
- remote registry architecture, agents, and milestones
