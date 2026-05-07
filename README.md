# workflow-manager

CLI runner for in-memory and Markdown/JSON workflow orchestration.

Install the latest prebuilt CLI with:

```bash
curl -fsSL https://github.com/navio/workflow-manager/releases/latest/download/workflow-manager-installer.sh | bash
wfm --help
```

## What it does

- Parses workflow definitions from Markdown frontmatter or JSON
- Validates structure, dependencies, adapters, and validation modes
- Executes workflow steps with deterministic run state transitions
- Emits a full event timeline and JSON run result
- Starts a local attach API for live run snapshots and SSE events
- Records authenticated CLI run telemetry for success, failure, and workflow effectiveness
- Publishes and pulls shared workflows from the remote registry

## Architecture

- `src/index.ts`: CLI commands (`questions`, `scaffold`, `validate`, `run`)
- `src/parser.ts`: parsing + validation
- `src/engine.ts`: execution loop, confirmations, retries, rollback/restart
- `src/mockExecutor.ts`: mock step executor for simulation
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

wfm scaffold ./example-workflow.md
wfm validate ./example-workflow.md
wfm run ./example-workflow.md --auto-confirm-all

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

During `wfm run`, the CLI starts a local attach API on `127.0.0.1`. Use `--port <n>` to bind a fixed port or omit it to let the OS choose one. The CLI prints the attach base URL and bearer token before execution starts.

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
wfm --help
```

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

Remote registry commands:

```bash
wfm auth whoami
wfm auth logout
wfm remote info alice/remote-bunny
```

## Agent skills

The published `@workflow-manager/runner` npm package now ships the CLI runner and the bundled agent skills together.

- bundled skill: `skills/workflow-manager-cli/SKILL.md`
- discovery keyword: `tanstack-intent`
- install flow: install `@workflow-manager/runner`, then run `npx @tanstack/intent@latest list` and `npx @tanstack/intent@latest install`

Example usage:

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
