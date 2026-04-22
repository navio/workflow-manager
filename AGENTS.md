# AGENTS Guide

This file is for coding agents working in `workflow-manager`.
It summarizes the current build/test workflow and the repository's coding patterns.

## Project Snapshot

- Runtime: Bun for scripts/tests, TypeScript for source, Node-compatible ESM output.
- Module system: `type: module` with `module: "NodeNext"` in `tsconfig.json`.
- Source lives in `src/`.
- Tests live in `tests/`.
- Built output goes to `dist/`.
- Docs site is VitePress under `doc/`.
- CLI entrypoint is `src/index.ts`.

## External Agent Rules

- Repo-local Cursor rules: none found.
- Repo-local `.cursorrules`: none found.
- Repo-local Copilot instructions: none found.
- Global CLI agent instructions may still apply outside this repo; follow them in addition to this file.

## Branch And Worktree Rules

- Always create a dedicated git worktree when starting work on a branch for non-trivial changes.
- Do not do feature work directly in the primary checkout when a branch/worktree workflow is possible.
- Prefer one worktree per active branch so generated files, test runs, and git status stay isolated.
- Before making branch-specific changes, confirm which worktree you are in and keep commands scoped to that worktree.
- Clean up temporary worktrees after the branch is merged or explicitly abandoned.

## Install And Setup

- Install deps: `bun install`
- Build TS output: `bun run build`
- Run CLI directly in dev: `bun run dev`
- View man page: `bun run man`

## Core Commands

- Full build: `bun run build`
- Full test suite: `bun test`
- Unit tests only: `bun run test:unit`
- E2E tests: `bun run test:e2e`
- Real OpenCode smoke e2e: `bun run test:e2e:real`
- Docs dev server: `bun run docs:dev`
- Docs build: `bun run docs:build`
- Docs preview: `bun run docs:preview`
- Remote registry app dev: `bun run remote-registry:dev`
- Remote registry app build: `bun run remote-registry:build`

## Binary Build Commands

- Native binary: `bun run build:bin`
- macOS arm64 binary: `bun run build:bin:macos`
- Linux x64 binary: `bun run build:bin:linux`
- Windows x64 binary: `bun run build:bin:windows`
- All release binaries: `bun run build:bin:all`

## Running A Single Test

- Single test file: `bun test tests/parser.test.ts`
- Another single file: `bun test tests/story-workflow.e2e.test.ts`
- Real adapter single file: `WORKFLOW_MANAGER_REAL_OPENCODE=1 bun test tests/opencode-real.e2e.test.ts`
- Filter by test name: `bun test tests/story-workflow.e2e.test.ts -t "runs the JSON story workflow using opencode adapter"`

## Practical Validation Sequences

- Typical code change: `bun run test:unit && bun run build`
- Workflow/executor change: `bun run test:unit && bun run test:e2e && bun run build`
- Real OpenCode integration change: `bun run test:unit && bun run test:e2e && bun run test:e2e:real && bun run build`
- Docs-only change: `bun run docs:build`
- Remote-registry app change: `bun run remote-registry:build`

## Linting And Formatting

- There is currently no dedicated lint script.
- There is currently no dedicated formatter config in the repo.
- Treat `bun run build` plus the test suite as the required quality gate.
- Keep formatting consistent with nearby files; do not introduce a new style system.

## Import Conventions

- Use ESM imports everywhere.
- Prefer Node built-ins via the `node:` prefix, e.g. `import fs from "node:fs"`.
- In `src/`, import local runtime modules with `.js` extensions, e.g. `./parser.js`.
- In `tests/`, import source files with `.ts` extensions, e.g. `../src/parser.ts`.
- Put `import type { ... }` imports after value imports when possible.
- Keep imports grouped simply; do not over-engineer ordering.

## TypeScript Rules

- `strict` mode is enabled; write code that passes strict typing without casts unless necessary.
- Prefer explicit function return types for exported functions and important internal helpers.
- Prefer `unknown` over `any` for untrusted input.
- Narrow dynamic values with small helpers such as `asRecord(...)`.
- Use repository types from `src/types.ts` instead of ad hoc shapes.
- Preserve the envelope contracts: `InputEnvelope`, `OutputEnvelope`, `RunResult`, `WorkflowDefinition`.
- Keep payloads serializable; outputs are often logged or returned as JSON.

## Naming Conventions

- Types/interfaces/type unions: `PascalCase`.
- Functions/variables/helpers: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for true constants, otherwise descriptive `camelCase` or `PascalCase` if the file already uses it.
- Test names should describe behavior, not implementation details.
- Step keys and workflow keys should remain stable strings because tests and docs reference them.

## Error Handling Expectations

- CLI-facing commands in `src/index.ts` should catch exceptions and return exit codes instead of crashing.
- Executor code should prefer structured `OutputEnvelope` failures over thrown exceptions.
- If input is invalid but recoverable, return `FAILED` or `QA_REJECTED` with a useful `feedback_reason`.
- If you must parse untrusted workflow payload fields, validate before use.
- Avoid swallowing errors silently; surface enough detail for debugging.

## Workflow Engine Conventions

- `runWorkflow(...)` is the central orchestration loop; preserve its event-driven shape.
- Dependencies are enforced before step execution.
- Step execution should route through explicit executor functions, not inline special cases when avoidable.
- Keep retry, rollback, and restart behavior deterministic.
- When adding an adapter, preserve existing behavior for `mock` paths unless intentionally changing semantics.
- Do not break JSON and Markdown workflow parity.

## Parser And Schema Conventions

- The parser supports both Markdown frontmatter and JSON files.
- Keep normalization in one place when possible.
- Validation should return string errors, not throw for ordinary schema problems.
- Required workflow fields are `key`, `title`, and `steps`.
- Supported adapters are currently `mock`, `opencode`, `codex`, and `claude-code`.

## Test Conventions

- Use `bun:test`.
- Keep unit tests deterministic and fast.
- Put reusable workflow fixtures in `tests/fixtures/`.
- Cover both JSON and Markdown workflow variants when format support changes.
- Real external execution tests must be opt-in and controlled by environment variables.
- If a test depends on local tooling like `opencode`, document the requirement clearly.

## Documentation Conventions

- Update `README.md` and `doc/` when CLI behavior, workflow schema, or test flows change.
- If you add a new command, update both CLI usage text and docs.
- If you add a new fixture-driven workflow example, document how to run it.
- Keep docs concrete and command-oriented.

## Remote Registry UI Design Source Of Truth

- For changes in `apps/remote-registry/src/` that affect layout, styling, components, or interaction patterns, read `apps/remote-registry/DESIGN.md` before editing code.
- Treat `apps/remote-registry/DESIGN.md` as the canonical design guidance for dashboard-facing pages such as `DashboardPage.tsx`, `HomePage.tsx`, and related shared UI primitives.
- Keep design-token usage, typography, accent semantics, and page-level UX patterns aligned with `apps/remote-registry/DESIGN.md` unless a deliberate design update is part of the change.

## Change Checklist For Agents

- Read the relevant source file fully before editing.
- Match existing file style instead of restyling unrelated code.
- Run the smallest relevant test first, then broader validation.
- For executor or workflow changes, verify both unit and e2e coverage.
- For real OpenCode changes, run `bun run test:e2e:real` before claiming integration works.
- Do not commit generated binaries or `dist/` output unless explicitly asked.
