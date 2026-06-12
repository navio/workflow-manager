# Workflow Schema

Workflow definitions can be provided as:

- Markdown files with YAML frontmatter (`.md`)
- JSON files (`.json`)

The parser expects `key`, `title`, and `steps` at minimum.

## Minimal examples

Markdown:

```md
---
key: minimal-demo
title: Minimal Demo
steps:
  - key: plan
    kind: task
    taskSpec:
      init:
        skills: [planning]
        mcps: [filesystem]
        systemPrompts: [Keep the plan concise]
---
```

JSON:

```json
{
  "key": "minimal-demo",
  "title": "Minimal Demo",
  "steps": [
    {
      "key": "plan",
      "kind": "task",
      "taskSpec": {
        "init": {
          "skills": ["planning"],
          "mcps": ["filesystem"],
          "systemPrompts": ["Keep the plan concise"]
        }
      }
    }
  ]
}
```

## Top-level fields

- `key` (required): unique workflow identifier
- `title` (required): default run objective
- `description`: optional summary
- `objectives`: optional list of run-level objectives
- `inputSchema`: optional JSON schema-like shape for inputs
- `outputSchema`: optional JSON schema-like shape for outputs
- `defaultRetryPolicy.maxAttempts`: fallback retry attempts for steps
- `steps` (required): ordered list of step definitions

## Step fields

- `key` (required): step id
- `kind` (required): `task | approval | system`
- `objective`: optional step-level objective
- `dependsOn`: list of prerequisite step keys
- `retryPolicy.maxAttempts`: step-level retry override
- `validation.mode`: `none | human | external`
- `validation.required`, `validation.autoConfirm`
- `taskSpec.adapterKey`: optional; omitted task adapters run with `pi-agent`. Explicit values are `pi-agent | mock | opencode | codex | claude-code`.
- `taskSpec.init.context`
- `taskSpec.init.skills`
- `taskSpec.init.mcps`
- `taskSpec.init.systemPrompts`
- `taskSpec.init.model`
- `taskSpec.payload.mockResult`: `success | retry | rollback | restart | yield | fail`
- `taskSpec.payload.requiredEnv`: optional list of environment variables required before a real adapter can run
- `approvalSpec.autoApprove`, `approvalSpec.validation`

## Validation rules enforced by the CLI

- step keys must be unique
- every dependency must reference an existing step
- dependencies must not form a cycle
- `kind` must be one of `task`, `approval`, `system`
- adapter key must be one of the supported adapters
- validation mode must be `none`, `human`, or `external`

## Runtime preflight

`wfm run` also checks host runtime requirements before execution starts:

- omitted task adapters use `pi-agent` and require the configured `pi` command (override with `WFM_PI_AGENT_COMMAND` or `taskSpec.payload.command`)
- real `opencode` steps require the `opencode` CLI
- real `claude-code` steps require the `claude` CLI
- known provider models require `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` (not enforced for `pi-agent` steps, since pi manages its own auth)
- custom LLM clients can declare required keys in `taskSpec.payload.requiredEnv`

Use `wfm doctor` to inspect host setup. Use `wfm doctor <workflow>` to run schema validation and runtime preflight without executing any steps.

Current adapter implementation status:

- `pi-agent`: real host adapter driving the `pi` coding agent CLI; default for omitted `taskSpec.adapterKey`
- `mock`: deterministic in-process simulator
- `opencode`: mock-routed by default; real host smoke path when `useRealAdapter` and `opencodeSmokeTest` are true
- `codex`: currently mock-routed; real executor not implemented yet
- `claude-code`: mock-routed by default; real host CLI path when `useRealAdapter` is true
