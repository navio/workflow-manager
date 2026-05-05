# AGENTS Guide

This file is for coding agents working in `workflow-manager`.
It captures the repository-specific commands, constraints, and coding conventions that show up in the current codebase.

## Project Snapshot

- Runtime: Bun for development and tests, TypeScript for source, Node-compatible ESM output.
- Package name: `@workflow-manager/runner`.
- Source code lives in `src/`.
- Tests live in `tests/`.
- Built output goes to `dist/`.
- Docs site lives in `doc/` and uses VitePress.
- The remote registry UI lives in `apps/remote-registry/`.
- The main CLI entrypoint is `src/index.ts`.

## Repo-Specific Rule Files

- Repo-local Cursor rules in `.cursor/rules/`: none found.
- Repo-local `.cursorrules`: none found.
- Repo-local Copilot instructions in `.github/copilot-instructions.md`: none found.
- Treat this file plus any higher-level CLI or environment instructions as the active agent guidance.

## Branch And Worktree Expectations

- Prefer a dedicated git worktree for non-trivial branch work and keep commands scoped to it.
- Do not assume the working tree is clean, and never revert user-authored changes unless explicitly asked.
- Do not commit generated binaries or `dist/` output unless explicitly requested.

## Install And Setup

- Install dependencies: `bun install`
- Run the CLI directly: `bun run dev`
- Build TypeScript output: `bun run build`
- Preview the man page: `bun run man`
- Dry-run the package contents: `bun run package:check`

## Root Build, Test, And Service Commands

- Full repo lint: `bun run lint`
- Full repo lint with safe fixes: `bun run lint:fix`
- Full TypeScript build: `bun run build`
- Full test suite: `bun test`
- Curated unit suite: `bun run test:unit`
- E2E suite: `bun run test:e2e`
- Real OpenCode E2E: `bun run test:e2e:real`
- Start local Supabase: `bun run supabase:start`
- Stop local Supabase: `bun run supabase:stop`
- Show local Supabase status: `bun run supabase:status`
- Reset local Supabase DB: `bun run supabase:db:reset`
- Lint local Supabase DB: `bun run supabase:db:lint`
- Run focused Supabase tests: `bun run supabase:test`
- Docs dev server: `bun run docs:dev`
- Docs build: `bun run docs:build`
- Docs preview: `bun run docs:preview`
- Remote registry app dev: `bun run remote-registry:dev`
- Remote registry app build: `bun run remote-registry:build`
- Remote registry auth tests: `bun run remote-registry:test`

## Additional Commands

- Native binary build: `bun run build:bin`
- All release binaries: `bun run build:bin:all`
- Docs production build: `bun run docs:build`
- Docs dev server: `bun run docs:dev`
- Remote registry build: `bun run remote-registry:build`
- Remote registry lint: `bun --cwd apps/remote-registry lint`
- Staged-file pre-commit lint: `bun run lint:staged`

## Running A Single Test

- Run one unit test file: `bun test tests/parser.test.ts`
- Run one E2E file: `bun test tests/story-workflow.e2e.test.ts`
- Run the omitted standalone test file directly: `bun test tests/owner-resolution.test.ts`
- Run one test name in one file: `bun test tests/runnerCli.test.ts -t "prints usage for invalid input"`
- Run the real OpenCode test file: `WORKFLOW_MANAGER_REAL_OPENCODE=1 bun test tests/opencode-real.e2e.test.ts`
- Bun accepts direct file paths, so use the smallest relevant file before broader suites.

## Validation Sequences Agents Should Prefer

- Parser, types, or CLI changes: `bun run lint && bun test tests/parser.test.ts && bun run build`
- Engine or executor changes: `bun run lint && bun run test:unit && bun run build`
- Workflow orchestration changes: `bun run lint && bun run test:unit && bun run test:e2e && bun run build`
- Real OpenCode integration changes: `bun run lint && bun run test:unit && bun run test:e2e && bun run test:e2e:real && bun run build`
- Remote registry UI changes: `bun run lint && bun run remote-registry:test && bun run remote-registry:build`
- Docs-only changes: `bun run docs:build`

## Imports And Formatting

- Use ESM imports everywhere and prefer Node built-ins through the `node:` prefix.
- In `src/`, local imports use `.js` extensions; in `tests/`, source imports use `.ts` paths.
- Keep value imports first, `import type` imports separate, and grouping simple.
- Use semicolons and prefer double quotes.
- Keep helpers close to their call sites; prefer small named helpers over deeply nested inline logic.
- Root linting uses `biome.json`; run `bun run lint` before claiming repository-wide TS/JS changes are done.
- Biome formatting is disabled for now, so match nearby style and avoid unrelated formatting churn.

## TypeScript And Type Rules

- `strict` mode is enabled; preserve strict typing.
- Prefer explicit types for exported functions and important internal helpers.
- Prefer `unknown` over `any` for untrusted values.
- Narrow dynamic data with runtime checks before use.
- Reuse shared domain types from `src/types.ts` instead of inventing parallel shapes.
- Keep payloads JSON-serializable where possible because workflows and run state are surfaced externally.
- Preserve established contracts such as `WorkflowDefinition`, `InputEnvelope`, `OutputEnvelope`, `RunResult`, and snapshot types.

## Naming Conventions

- Types, interfaces, and unions use `PascalCase`; functions, variables, and helpers use `camelCase`.
- True constants use `UPPER_SNAKE_CASE`.
- Step keys, workflow keys, and status strings are stable identifiers; change them cautiously.
- Test names should describe behavior and expected outcome.

## Error Handling Expectations

- CLI-facing code should fail with clear messages and exit codes rather than uncaught crashes.
- Validation errors should usually be returned as strings, not thrown, for ordinary user-input problems.
- Executor flows should prefer structured `OutputEnvelope` failures over ad hoc exceptions.
- Do not swallow errors silently.
- Include enough context for debugging without dumping unnecessary noise.
- Validate untrusted workflow fields before using them in filesystem, process, or network operations.

## Workflow Engine Conventions

- `runWorkflow(...)` in `src/engine.ts` is the orchestration center.
- Preserve the event-driven snapshot and observer flow when editing engine behavior.
- Keep dependency resolution deterministic.
- Route task execution through executor functions instead of scattering adapter logic inline.
- Preserve approval, retry, rollback, and restart semantics unless the change intentionally updates them.
- Maintain parity between JSON and Markdown workflow formats.

## Parser And Schema Conventions

- The parser supports both Markdown frontmatter and JSON workflow files.
- Normalize defaults in one place when possible.
- Required workflow fields are `key`, `title`, and `steps`.
- Supported adapters are currently `mock`, `opencode`, `codex`, and `claude-code`.
- Skills validation is strict about source paths and optional SHA-256 metadata.
- Prefer additive schema changes with backward-compatible defaults.

## Test Conventions

- Tests use `bun:test`.
- Keep unit tests deterministic and fast.
- Use temporary directories for filesystem tests and clean them up when needed.
- Cover both JSON and Markdown workflow paths when changing format support.
- Real external integration tests must stay opt-in behind environment variables.
- If you add a new root test file, consider whether it belongs in `test:unit` or should remain standalone.

## Documentation And UI Guidance

- Update `README.md` and `doc/` when CLI commands, schema, or user-facing behavior change.
- If you add a new command, update usage text in `src/index.ts` as well as docs.
- For UI work in `apps/remote-registry/src/`, read `apps/remote-registry/DESIGN.md` first and preserve its typography, tokens, accent semantics, and component rules.

## Change Checklist For Agents

- Read the full file you plan to edit and make the smallest change that fully solves the task.
- Run `bun run lint` plus the narrowest relevant test first, then broaden validation as needed.
- Run `bun run build` for root TypeScript changes and app lint plus build for remote registry UI changes.
- Leave unrelated files and unrelated failures untouched unless the task requires otherwise.
