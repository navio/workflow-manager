# workflow-manager

CLI runner for in-memory and Markdown-defined workflow orchestration.

## What it does

- Parses workflow definitions from Markdown frontmatter
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
npm install
npm run build
npm link

workflow-manager scaffold ./example-workflow.md
workflow-manager validate ./example-workflow.md
workflow-manager run ./example-workflow.md --auto-confirm-all
```

## Build

```bash
npm run build
npm test
```

Documentation site:

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

## Contribution

- Keep workflow contracts backward-compatible when possible (`src/types.ts`)
- Update docs under `doc/` when changing schema or runtime behavior
- Add or update tests in `tests/` when touching parser or engine logic

Netlify documentation deployment is configured with `netlify.toml`:

- build command: `npm run docs:build`
- publish directory: `doc/.vitepress/dist`

When this repository is connected to Netlify, these settings are applied automatically.

## Documentation

VitePress docs are in `doc/` and focus on:

- how the workflow manager works
- runtime architecture
- workflow schema
- practical workflow examples and implementation patterns
