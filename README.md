# workflow-manager

CLI runner for in-memory and Markdown/JSON workflow orchestration.

## What it does

- Parses workflow definitions from Markdown frontmatter or JSON
- Validates structure, dependencies, adapters, and validation modes
- Executes workflow steps with deterministic run state transitions
- Emits a full event timeline and JSON run result

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

Documentation site:

```bash
bun run docs:dev
bun run docs:build
bun run docs:preview
```

Manual help:

```bash
workflow-manager man
```

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
