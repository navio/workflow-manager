---
name: @workflow-manager/runner/cli
description: >
  Load this skill when working with the wfm CLI from @workflow-manager/runner, authoring or
  validating workflow definitions, configuring step skills and adapters, or
  publishing workflows to the remote registry. Covers questions, scaffold,
  validate, run, auth, publish, pull, search, and remote info.
type: core
library: @workflow-manager/runner
library_version: "0.1.0"
sources:
  - "navio/workflow-manager:README.md"
  - "navio/workflow-manager:src/index.ts"
  - "navio/workflow-manager:src/parser.ts"
  - "navio/workflow-manager:src/engine.ts"
  - "navio/workflow-manager:src/remote/commands.ts"
---

# wfm CLI

Use this skill when you need to create or operate `workflow-manager` workflows from the terminal with `wfm`.

## When to use this skill

Use it when the user wants to:

- scaffold a new workflow definition
- validate or run a workflow file
- configure approvals, retry policy, or adapter initialization
- publish a workflow to the remote registry
- search for or pull a shared workflow
- understand the difference between Markdown and JSON workflow formats

## Core workflow

Use this sequence unless the user asks for a narrower task:

1. Discover the workflow intent with `wfm questions`
2. Scaffold a starter file with `wfm scaffold`
3. Edit the workflow definition
4. Validate the file with `wfm validate`
5. Execute it with `wfm run`
6. If needed, authenticate and publish with the remote registry commands

## Local workflow commands

```bash
wfm questions

wfm scaffold ./example-workflow.md
wfm scaffold ./example-workflow.json --format json

wfm validate ./example-workflow.md
wfm validate ./example-workflow.json

wfm run ./example-workflow.md --confirm discover,qa_gate:human
wfm run ./example-workflow.json --auto-confirm-all
```

## Remote registry commands

```bash
wfm auth login --token <token>
wfm auth whoami
wfm auth logout

wfm search bunny
wfm remote info alice/remote-bunny
wfm publish ./example-workflow.json --visibility public --tag storytelling,example
wfm pull alice/remote-bunny --output ./remote-bunny.json
```

## Skill guidance

- Prefer `validate` before `run` or `publish`
- Keep `runWorkflow(...)` behavior registry-agnostic; registry operations belong in the CLI remote commands
- Use Markdown workflows when the user wants editable frontmatter plus notes
- Use JSON workflows when the user wants machine-generated or strongly structured files
- Use `--auto-confirm-all` only when the workflow is intentionally non-interactive
- When publishing, preserve the source format the user authored

## Workflow authoring checklist

- Set stable `key` and `title` values
- Define clear step `objective` text
- Add `dependsOn` relationships explicitly
- Set validation mode per step (`none`, `human`, `external`)
- Configure adapter initialization under `taskSpec.init`
- Use stable step keys because tests and docs may refer to them

## Adapter and validation notes

- Supported adapters include `mock`, `opencode`, `codex`, and `claude-code`
- Human approvals should stay explicit in workflow definitions
- External validation should be deterministic where possible
- Use the mock adapter for fast tests and scaffolding flows

## Recommended project references

- `src/index.ts`: CLI command entrypoint
- `src/parser.ts`: Markdown and JSON parsing plus validation
- `src/engine.ts`: orchestration loop
- `src/remote/commands.ts`: auth, publish, pull, search, and remote info commands
- `tests/`: unit and e2e coverage for workflow behavior

## Typical troubleshooting

- If validation fails, inspect the reported schema or dependency error before running again
- If `publish` fails, confirm the user is logged in with `wfm auth whoami`
- If remote calls fail in the browser, verify the remote registry app has valid Supabase `VITE_*` environment variables
- If a real adapter test fails, confirm the underlying external CLI is installed and available on `PATH`
