# workflow-manager

CLI runner for in-memory and Markdown/JSON workflow orchestration.

## What it does

- Parses workflow definitions from Markdown frontmatter or JSON
- Validates structure, dependencies, adapters, and validation modes
- Executes workflow steps with deterministic run state transitions
- Emits a full event timeline and JSON run result
- Publishes and pulls shared workflows from the remote registry

## Architecture

- `src/index.ts`: CLI commands (`questions`, `scaffold`, `validate`, `run`)
- `src/parser.ts`: parsing + validation
- `src/engine.ts`: execution loop, confirmations, retries, rollback/restart
- `src/mockExecutor.ts`: mock step executor for simulation
- `src/events.ts`: event sequencing/logging
- `src/types.ts`: contracts and status enums

## Quick start

```bash
bun install
bun run build
bun link

workflow-manager scaffold ./example-workflow.md
workflow-manager validate ./example-workflow.md
workflow-manager run ./example-workflow.md --auto-confirm-all

# JSON workflow support
workflow-manager scaffold ./example-workflow.json --format json
workflow-manager validate ./example-workflow.json
workflow-manager run ./example-workflow.json --auto-confirm-all

# Remote registry
workflow-manager auth login --token <token>
workflow-manager search bunny
workflow-manager publish ./example-workflow.json --visibility public --tag storytelling,example
workflow-manager pull alice/remote-bunny --output ./remote-bunny.json
```

## Build

```bash
bun run build
bun test
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

Remote registry app:

```bash
bun run remote-registry:dev
bun run remote-registry:build
```

Manual help:

```bash
workflow-manager man
```

Remote registry commands:

```bash
workflow-manager auth whoami
workflow-manager auth logout
workflow-manager remote info alice/remote-bunny
```

The deployed registry dashboard also supports browser-based token creation, workflow publishing, and creator analytics.

Current dashboard capabilities include:

- creator workflow analytics
- token list and revoke controls
- browser-based workflow publishing for JSON and Markdown sources

## Contribution

- Keep workflow contracts backward-compatible when possible (`src/types.ts`)
- Update docs under `doc/` when changing schema or runtime behavior
- Add or update tests in `tests/` when touching parser or engine logic

Netlify documentation deployment is configured with `netlify.toml`:

- build command: `npm run docs:build`
- publish directory: `doc/.vitepress/dist`

When this repository is connected to Netlify, these settings are applied automatically.

## Release

- Push a semantic tag like `v0.2.0` to trigger the GitHub Actions release workflow.
- The workflow runs tests and build, then compiles binaries for:
  - macOS arm64: `workflow-manager-macos-arm64`
  - Linux x64: `workflow-manager-linux-x64`
  - Windows x64: `workflow-manager-windows-x64.exe`
- Assets are attached to the GitHub Release for that tag.

## Documentation

VitePress docs are in `doc/` and focus on:

- how the workflow manager works
- runtime architecture
- workflow schema
- practical workflow examples and implementation patterns
- CLI manual help usage
- remote registry architecture, agents, and milestones
