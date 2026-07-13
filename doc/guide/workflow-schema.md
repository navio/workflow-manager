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
- `validation.mode`: `none | human | external | agent` — see [Validation](#validation) below for the `agent` mode fields and routing semantics
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
  - `taskSpec.payload.acpAgent`: a preset name (`claude-code | opencode | gemini | codex`) when `adapterKey` is `acp`
  - `taskSpec.payload.acpPermissions`: `allow` (default) | `deny` | `reads-only`
  - `taskSpec.payload.acpAuthMethod`: ACP auth method id when the agent requires authentication
  - `taskSpec.payload.legacyExecutor`: set `true` to use the deprecated bespoke `claude-code` / `opencode` subprocess executor instead of ACP
- `approvalSpec.autoApprove`, `approvalSpec.validation`

## Validation

`validation.mode` gates how a step's execution result is confirmed before the run proceeds:

- `none`: no confirmation required
- `human`: requires `--confirm stepKey`, `--auto-confirm-all`, or step-level `autoConfirm`
- `external`: resolved by an outside system (a webhook, another process) calling the attach API's approve/resume endpoints
- `agent`: a second, independent agent call validates the step's output against explicit criteria (see below)

Common fields: `validation.required` (whether confirmation is mandatory at all) and `validation.autoConfirm` (skip confirmation and treat the step as pre-approved).

### `mode: "agent"` and `AgentValidationSpec`

Set `validation.agent` to configure the validator call:

- `agent.adapterKey`: optional; one of the supported adapters (`pi-agent | mock | acp | opencode | codex | claude-code`). Defaults to the validated step's own `taskSpec.adapterKey` when omitted.
- `agent.criteria`: optional natural-language acceptance criteria the validator checks the step's output against. Prefer criteria phrased as a checkable fact ("tests pass," "no unrelated files changed") over subjective taste calls.
- `agent.init`: optional `TaskInitConfig` (`model`, `skills`, `mcps`, `systemPrompts`, `context`) for the validator's own agent call — independent of the validated step's `taskSpec.init`.
- `agent.payload`: optional adapter payload, e.g. `{ mockResult: "success" }` to drive the mock adapter through agent validation during a dry run.

```yaml
validation:
  mode: agent
  required: true
  autoConfirm: false
  agent:
    criteria: "tests pass, the fix addresses a root cause, and no unrelated files changed"
    init:
      model: openrouter/anthropic/claude-sonnet-4
```

**Routing semantics:** the validator's verdict is folded into the same QA routing the engine uses for a step's own self-reported result — an execution status (`SUCCESS`, `FAILED`, `QA_REJECTED`, `YIELD_EXTERNAL`) plus an action: `PROCEED` continues to the next step, `RETRY_CURRENT` reruns the validated step, `ROLLBACK_PREVIOUS` reruns an earlier step, `RESTART_ALL` restarts the run. Retries from an agent-validation rejection are bounded by the step's `retryPolicy.maxAttempts` (or `defaultRetryPolicy.maxAttempts`) like any other rejection. The engine emits `step.validation_started` and `step.validation_finished` events around the validator call.

`mode: agent` runs unconditionally once a step's own execution finishes — `--auto-confirm-all` and step-level `autoConfirm` never skip it, because it is a QA gate on the output, not a human sign-off gate.

**Restriction:** `mode: agent` is not allowed on an approval step's `approvalSpec.validation` — the parser rejects it (`Approval step <key> cannot use agent validation`). Use a dedicated `kind: task` step with `validation.mode: agent` upstream of the approval instead.

**Approval-step gotcha:** an unset step-level `validation` defaults to `{ mode: "none", required: false, autoConfirm: true }` — including on `approval` steps. Because `canConfirm` checks the step's own `validation.autoConfirm` before `approvalSpec.validation.autoConfirm`, an approval step that only sets `approvalSpec.validation` (and leaves top-level `validation` unset) will silently auto-approve instead of waiting for a human. Always set both `validation` and `approvalSpec.validation` on an approval step, with matching `mode`/`required`/`autoConfirm`. See [Authoring Workflows With an Agent](/guide/authoring-with-an-agent#approvals-human-decides-or-the-agent-decides-for-you) for a worked example.

## Validation rules enforced by the CLI

- step keys must be unique
- every dependency must reference an existing step
- dependencies must not form a cycle
- `kind` must be one of `task`, `approval`, `system`
- adapter key must be one of the supported adapters
- validation mode must be `none`, `human`, `external`, or `agent`
- `mode: agent` is not allowed on an approval step's `approvalSpec.validation`
- when `validation.mode` is `agent` and `validation.agent.adapterKey` is set, it must be one of the supported adapters

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
- `acp`: Agent Client Protocol adapter; connects to any ACP agent over JSON-RPC/stdio when `useRealAdapter` is true and an agent command resolves. Verified against `gemini --experimental-acp`; set `payload.acpAgent: gemini` (or `acpCommand`/`acpArgs`).
- `opencode`: routed through ACP (`opencode acp`) when `useRealAdapter` is true; bespoke executor deprecated (`payload.legacyExecutor`)
- `codex`: routed through ACP via the `codex-acp` bridge when `useRealAdapter` is true (`codex` itself has no native ACP). Install the bridge with `npm install -g @agentclientprotocol/codex-acp`; it reuses the codex CLI's own auth (`codex login` or API key).
- `claude-code`: routed through ACP via the `claude-code-acp` bridge when `useRealAdapter` is true; bespoke executor deprecated (`payload.legacyExecutor`)

When a step explicitly selects a non-pi adapter but the real path is not enabled (no `useRealAdapter`, or no resolvable ACP agent command), the step runs as a mock. `wfm doctor <workflow>` reports this under "Adapter warnings" and `wfm run` prints a warning before execution, so the fallback is never silent.
