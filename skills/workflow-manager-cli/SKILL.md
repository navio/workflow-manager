---
name: workflow-manager/workflow-manager-cli
description: >
  Load this skill when working with the workflow-manager CLI, authoring or
  validating workflow definitions, configuring step skills and adapters, or
  publishing workflows to the remote registry. Covers questions, scaffold,
  validate, run, auth, publish, pull, search, and remote info.
type: core
library: workflow-manager
library_version: "0.1.0"
sources:
  - "navio/workflow-manager:README.md"
  - "navio/workflow-manager:src/index.ts"
  - "navio/workflow-manager:src/parser.ts"
  - "navio/workflow-manager:src/engine.ts"
  - "navio/workflow-manager:src/remote/commands.ts"
---

# workflow-manager CLI

Use this skill when you need to create or operate `workflow-manager` workflows from the terminal.

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

1. Discover the workflow intent with `workflow-manager questions`
2. Scaffold a starter file with `workflow-manager scaffold`
3. Edit the workflow definition
4. Validate the file with `workflow-manager validate`
5. Execute it with `workflow-manager run`
6. If needed, authenticate and publish with the remote registry commands

## Local workflow commands

```bash
workflow-manager questions

workflow-manager scaffold ./example-workflow.md
workflow-manager scaffold ./example-workflow.json --format json

workflow-manager validate ./example-workflow.md
workflow-manager validate ./example-workflow.json

workflow-manager run ./example-workflow.md --confirm discover,qa_gate:human
workflow-manager run ./example-workflow.json --auto-confirm-all
```

## Remote registry commands

```bash
workflow-manager auth login --token <token>
workflow-manager auth whoami
workflow-manager auth logout

workflow-manager search bunny
workflow-manager remote info alice/remote-bunny
workflow-manager publish ./example-workflow.json --visibility public --tag storytelling,example
workflow-manager pull alice/remote-bunny --output ./remote-bunny.json
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
- If `publish` fails, confirm the user is logged in with `workflow-manager auth whoami`
- If remote calls fail in the browser, verify the remote registry app has valid Supabase `VITE_*` environment variables
- If a real adapter test fails, confirm the underlying external CLI is installed and available on `PATH`
