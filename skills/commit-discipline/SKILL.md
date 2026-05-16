---
name: commit-discipline
description: >
  Load this skill before staging commits or opening a pull request in
  workflow-manager. Enforces Conventional Commits, focused diffs, a clean
  rebase onto origin/main, and PR descriptions that link to the work.
type: core
applies_to:
  - ".git/**"
  - "**/*"
---

# Commit Discipline

Use this skill at the moment you are about to `git add`, `git commit`, or `gh pr create`. It encodes how this repo expects commits and PRs to look so that history stays readable and release tooling (release-please, changelogs) keeps working.

## When to use this skill

Load it when you are about to:

- Stage changes for commit.
- Author a commit message.
- Rebase onto `origin/main` before opening a PR.
- Open or update a pull request.

Skip it for purely exploratory commands that do not touch git state.

## Conventional Commits

This repo uses Conventional Commits. The release tooling (`release-please-config.json`) reads commit subjects to decide version bumps and changelog entries. Format:

```
<type>(<optional-scope>): <imperative summary>
```

Allowed `type` values:

- `feat` — user-visible new functionality.
- `fix` — user-visible bug fix.
- `perf` — performance improvement with no behavior change.
- `refactor` — internal restructuring, no behavior change, no new feature.
- `docs` — documentation only.
- `test` — tests only.
- `build` — build system, packaging, dependencies.
- `ci` — CI configuration only.
- `chore` — repo plumbing that does not fit the above and has no user impact.
- `revert` — reverts a previous commit; reference the reverted SHA.

Rules:

- Subject in the imperative mood, no trailing period, max 72 chars.
- Use a scope when the change is localized (e.g., `feat(cli): ...`, `fix(parser): ...`, `feat(remote-registry): ...`).
- Use `!` for breaking changes (e.g., `feat(cli)!: rename --token to --auth-token`) AND include a `BREAKING CHANGE:` footer explaining the migration.
- Body (optional) explains _why_, not _what_; reference issues/PRs by number.

## Commit hygiene

- One logical change per commit. Do not bundle unrelated edits.
- Never commit secrets, `.env*` files, real tokens, generated `dist/` output (unless explicitly requested), `node_modules/`, or local Supabase data.
- Never amend or force-push commits that already exist on `main`. Force-push to feature branches is allowed only with `--force-with-lease`.
- If pre-commit / pre-push hooks fail, fix the underlying issue. Do not bypass with `--no-verify` unless the user explicitly asks.

## Before opening a PR

Inside the feature worktree:

```bash
git fetch origin
git rebase origin/main
bun run lint
bun test
bun run build
```

Plus the conditional scripts from `repo-hygiene` / `doc-sync` when applicable.

If the rebase produces conflicts you cannot confidently resolve, stop and surface them to the user instead of force-pushing through them.

## PR description template

Open PRs against `main` with a description that contains:

1. **Summary** — 1–3 bullets describing the change in user-visible terms.
2. **Why** — link to the issue, spec, or user request driving the change.
3. **How** — short note on the approach; call out anything non-obvious.
4. **Validation** — list the exact commands you ran and that they passed (lint, test, build, plus any conditional ones).
5. **Docs** — link to the doc files updated, or state explicitly "no user-visible behavior changed".
6. **Risk / rollout** — call out feature flags, migration steps, or follow-ups.

Example title:

```
feat(cli): add `wfm pull --output` flag for redirecting fetched workflows
```

## Anti-patterns to refuse

- Subjects like `update stuff`, `wip`, `fix things`, `address review`.
- Squashing unrelated commits together to "clean up history" right before merge.
- Pushing to `main` directly.
- Opening a PR with failing CI and asking reviewers to "ignore the red".
- Mixing a refactor and a behavior change in the same commit.

## Definition of done

- Every commit subject is a valid Conventional Commit.
- Branch is rebased on the latest `origin/main`.
- All required scripts (lint, test, build, plus conditional ones) passed locally.
- PR description follows the template and links updated docs.
