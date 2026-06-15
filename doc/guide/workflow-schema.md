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
- `taskSpec.adapterKey`: optional; omitted task adapters run with `pi-agent`. Explicit values are `pi-agent | mock | acp | opencode | codex | claude-code`.
- `taskSpec.init.context`
- `taskSpec.init.skills`
- `taskSpec.init.mcps` (http(s) endpoints are passed to ACP agents as session MCP servers)
- `taskSpec.init.systemPrompts`
- `taskSpec.init.model`
- `taskSpec.payload.mockResult`: `success | retry | rollback | restart | yield | fail`
- `taskSpec.payload.requiredEnv`: optional list of environment variables required before a real adapter can run
- ACP payload fields (for `acp` and the ACP-routed `claude-code | opencode | codex`):
  - `taskSpec.payload.useRealAdapter`: set `true` to run the agent through ACP (otherwise the step mocks)
  - `taskSpec.payload.acpCommand` / `acpArgs`: explicit ACP agent command and args
  - `taskSpec.payload.acpAgent`: a preset name (`claude-code | opencode | gemini`) when `adapterKey` is `acp`
  - `taskSpec.payload.acpPermissions`: `allow` (default) | `deny` | `reads-only`
  - `taskSpec.payload.acpAuthMethod`: ACP auth method id when the agent requires authentication
  - `taskSpec.payload.legacyExecutor`: set `true` to use the deprecated bespoke `claude-code` / `opencode` subprocess executor instead of ACP
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
- ACP-routed steps require the resolved ACP agent command on `PATH` (`acpCommand` / `acpAgent` preset / `WFM_ACP_COMMAND`)
- legacy `opencode` / `claude-code` steps (with `payload.legacyExecutor: true`) require the `opencode` / `claude` CLI
- known provider models require `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` (not enforced for `pi-agent` or ACP steps, since those agents manage their own auth)
- custom LLM clients can declare required keys in `taskSpec.payload.requiredEnv`

Use `wfm doctor` to inspect host setup. Use `wfm doctor <workflow>` to run schema validation and runtime preflight without executing any steps.

Current adapter implementation status:

- `pi-agent`: real host adapter driving the `pi` coding agent CLI; default for omitted `taskSpec.adapterKey`
- `mock`: deterministic in-process simulator
- `acp`: Agent Client Protocol adapter; connects to any ACP agent over JSON-RPC/stdio when `useRealAdapter` is true and an agent command resolves
- `opencode`: routed through ACP when `useRealAdapter` is true; bespoke executor deprecated (`payload.legacyExecutor`)
- `codex`: routed through ACP when `useRealAdapter` and an `acpCommand`/`acpAgent` are set; otherwise mock
- `claude-code`: routed through ACP when `useRealAdapter` is true; bespoke executor deprecated (`payload.legacyExecutor`)

When a step explicitly selects a non-pi adapter but the real path is not enabled (no `useRealAdapter`, or no resolvable ACP agent command), the step runs as a mock. `wfm doctor <workflow>` reports this under "Adapter warnings" and `wfm run` prints a warning before execution, so the fallback is never silent.
