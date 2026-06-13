# workflow-manager skills

`@workflow-manager/runner` now ships its TanStack Intent-compatible skills in the main npm package.

The first bundled skill is `workflow-manager-cli`, which teaches agents how to:

- design workflow definitions
- scaffold Markdown or JSON workflows
- validate and run workflows safely
- authenticate against the remote registry
- publish, search, and pull shared workflows

## Install

Install the main package in the project where you want the CLI and skill available:

```bash
npm install @workflow-manager/runner
```

Then install bundled skills into an agent's skill directory with the CLI:

```bash
wfm skill list                       # list bundled skills
wfm skill install                    # workflow-manager-cli -> ./.claude/skills/
wfm skill install --global           # -> ~/.claude/skills/
wfm skill install --agent opencode   # -> ./.opencode/skill/
wfm skill install --all              # install every bundled skill
wfm skill install <name> --dir path  # install into any directory
```

`wfm skill install` copies the skill directory (`SKILL.md` plus any assets) into the
target so the agent loads it on demand; pass `--force` to overwrite an existing install.

Alternatively, use TanStack Intent to discover and map the shipped skills into your agent configuration:

```bash
npx @tanstack/intent@latest list
npx @tanstack/intent@latest install
```

Intent writes task-to-skill mappings into `AGENTS.md`-style config files and points them at the installed package path under `node_modules/@workflow-manager/runner/skills/...`.

## Packaged skill

- skill path: `skills/workflow-manager-cli/SKILL.md`
- package keyword: `tanstack-intent`
- published with: the root `@workflow-manager/runner` npm package

## Local development

From the repository root:

```bash
npm pack --dry-run
ls skills/workflow-manager-cli
```

## Publish

Publish from the repository root so the CLI runner and `skills/` ship together:

```bash
npm publish
```

Before publishing, verify the package contents:

```bash
npm pack --dry-run
```

## Package layout

- `skills/workflow-manager-cli/SKILL.md`: TanStack Intent skill entrypoint
- `skills/workflow-manager-cli/README.md`: local notes for contributors
- `package.json`: package metadata, published files, and `tanstack-intent` keyword
