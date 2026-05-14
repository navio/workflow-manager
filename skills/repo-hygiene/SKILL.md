---
name: repo-hygiene
description: >
  Load this skill on any code change in workflow-manager. It enforces the
  "leave the repo cleaner than you found it" rules: no dead code, no orphan
  files, no stray comments, no unrelated formatting churn, and validated
  scripts before declaring done.
type: core
applies_to:
  - "src/**"
  - "apps/**"
  - "tests/**"
  - "scripts/**"
---

# Repo Hygiene

Use this skill whenever you edit, add, or delete code in this repository. It encodes the cleanliness rules already implied by `AGENTS.md` and `biome.json`, made explicit so they are followed every time.

## When to use this skill

Load it for any change under `src/`, `apps/`, `tests/`, or `scripts/`. Skip only for pure docs work in `doc/` and pure markdown edits at the repo root (those load `doc-sync` instead).

## Core rules

1. Smallest viable change. Edit only what the task requires. Do not refactor unrelated code, do not reformat unrelated files, do not rename unrelated symbols.
2. No dead code. Remove unused imports, unused exports, unused locals, unreachable branches, and obsolete helpers in the files you touch. Do not leave `TODO`/`FIXME` without an associated issue link or a short, dated reason.
3. No stray comments. Per `AGENTS.md` code style, do not add explanatory comments unless the user explicitly asks for them. Keep existing comments only if they are still accurate; delete misleading ones.
4. File placement matters. Source goes in `src/`. Tests go in `tests/`. Remote-registry UI code stays inside `apps/remote-registry/`. Scripts stay in `scripts/`. Do not create new top-level files unless the task explicitly calls for them.
5. Import discipline. ESM only. Node built-ins use the `node:` prefix. In `src/`, local imports use `.js` extensions; in `tests/`, local imports use `.ts` paths. Keep value imports first, then `import type` imports.
6. Strict typing. Prefer `unknown` over `any` for untrusted input and narrow it before use. Reuse shared types from `src/types.ts` instead of inventing parallel shapes. Keep payloads JSON-serializable where possible.
7. Error handling. CLI-facing code exits with clear messages and non-zero codes for failure. Validation errors are returned as strings for ordinary user-input problems, not thrown. Executor flows return structured `OutputEnvelope` failures rather than ad hoc exceptions.
8. No silent swallowing. Never `catch` and ignore. If an error is intentionally non-fatal, log it with enough context to debug.
9. No secrets. Never log tokens, env values, or credentials. Never commit `.env*` files or any local Supabase keys.

## Pre-completion checklist

Before declaring a task done, run inside the worktree:

```bash
bun run lint
bun test            # narrowest relevant subset first; then full suite
bun run build
```

Plus, when applicable:

```bash
bun run remote-registry:test && bun run remote-registry:build   # apps/remote-registry/**
bun run docs:build                                              # doc/** or user-facing CLI/schema
```

If any script fails, fix it or stop and report it. Do not declare completion with a red script.

## Anti-patterns to refuse

- Adding a new dependency without checking `package.json` first.
- Introducing a new top-level config file when an existing one can be extended.
- Reformatting whole files because the editor auto-formatted them.
- Leaving commented-out code "in case we need it later" — git history is the archive.
- Mixing an unrelated refactor into a feature PR.

## Definition of clean

A change is clean when:

- The diff contains only lines required by the task.
- `git status` shows no unintended new files.
- `bun run lint`, `bun test`, and `bun run build` are all green.
- A future reader can understand the change without an accompanying explanation message.
