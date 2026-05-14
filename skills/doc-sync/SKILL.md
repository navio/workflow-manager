---
name: doc-sync
description: >
  Load this skill whenever a change affects user-visible behavior in
  workflow-manager: CLI flags, command output, workflow schema, public
  TypeScript types, adapters, the remote registry surface, or environment
  variables. Ensures README, doc/, AGENTS.md, and in-CLI help stay in sync.
type: core
applies_to:
  - "src/index.ts"
  - "src/parser.ts"
  - "src/engine.ts"
  - "src/types.ts"
  - "src/remote/**"
  - "apps/remote-registry/**"
  - "doc/**"
  - "README.md"
  - "AGENTS.md"
---

# Doc Sync

Use this skill to keep documentation honest. In this repo, documentation is part of the product surface — the CLI is published, workflows are shared via the remote registry, and the docs site is built from `doc/`. Out-of-date docs are a bug.

## When to use this skill

Load it whenever the change does any of the following:

- Adds, removes, or renames a CLI command, flag, or argument in `src/index.ts`.
- Changes workflow schema, defaults, or validation rules in `src/parser.ts` or `src/types.ts`.
- Changes engine semantics (approvals, retries, rollback, restart, snapshot shape) in `src/engine.ts`.
- Adds or changes an adapter (`mock`, `opencode`, `codex`, `claude-code`, future adapters).
- Changes remote registry behavior in `src/remote/**` or `apps/remote-registry/**`.
- Introduces or renames an environment variable or required local service.
- Bumps a public type or contract referenced by docs or other packages.

If none of the above is true, this skill is not needed.

## Required updates by change type

| Change | Update |
| --- | --- |
| New / renamed CLI command or flag | Usage text in `src/index.ts`, `README.md` Quickstart and CLI section, the matching `doc/` page, and the man page source if behavior is reflected there. |
| Workflow schema change | `README.md` schema section, the relevant page under `doc/guide/` or `doc/reference/`, plus the `workflow-manager-cli` skill checklist if authoring rules shift. |
| Engine semantics change | The corresponding `doc/` engine page and any example workflows in `example-workflow.{md,json}` that no longer demonstrate the new behavior accurately. |
| Adapter added or changed | List of supported adapters in `AGENTS.md`, `README.md`, and `doc/`. The `workflow-manager-cli` skill must also list it. |
| Remote registry change | `apps/remote-registry/DESIGN.md` if UI/UX shifts, `README.md` remote section, `doc/` remote pages, and any onboarding snippets. |
| New env var or required service | `README.md` setup section, `AGENTS.md` Install And Setup, and any `.env.example` files. Never commit real secrets. |

## Workflow

1. Diff your change and list every user-visible surface it touches.
2. For each surface, open the matching doc file and update it in the same PR. Do not defer to a follow-up.
3. Rebuild docs to catch broken links or examples:
   ```bash
   bun run docs:build
   ```
4. If you changed the remote-registry app, also run:
   ```bash
   bun run remote-registry:build
   ```
5. Re-read the README quickstart end-to-end and confirm the commands you ship still work as written.

## Style rules

- Match the existing tone of the surrounding doc. Do not introduce a new voice.
- Prefer runnable examples over prose. Examples should match the actual current CLI output.
- Keep command examples copy-pasteable. No invented flags or fictitious env vars.
- When you remove or rename a flag, document the migration in the same section, not in a separate changelog-only entry.
- Cross-link related docs sparingly and only when they meaningfully help the reader.

## Anti-patterns to refuse

- Updating code without updating docs "because the docs are out of date anyway".
- Adding a doc page that is not linked from the docs nav or another page.
- Copying README content into `doc/` instead of linking, creating two sources of truth.
- Leaving `TODO: update docs` markers in a finished PR.

## Definition of done

- Every user-visible behavioral change is reflected in `README.md`, the relevant `doc/` pages, in-CLI `--help`, and `AGENTS.md` where applicable.
- `bun run docs:build` passes.
- Examples in updated docs were actually executed (or visually verified) against the new behavior.
