# How It Works

`workflow-manager` turns a Markdown workflow definition into a deterministic run.

## Execution flow

1. Parse Markdown frontmatter into a `WorkflowDefinition`.
2. Validate schema-level constraints (keys, dependencies, adapters, validation modes).
3. Initialize queued run state and create a `StepRun` for each step.
4. Validate host runtime access for real adapters before execution starts.
5. Execute steps in dependency order, enforcing `dependsOn` before each step starts.
6. Build an input envelope with global state, step context, and adapter init data.
7. Execute the step with the `pi` coding agent by default, or with an explicit adapter such as `mock`, `opencode`, `codex`, or `claude-code`.
8. Apply validation and confirmation policy.
9. Resolve routing actions (`RETRY_CURRENT`, `ROLLBACK_PREVIOUS`, `RESTART_ALL`, or proceed).
10. Record run and step events in sequence.
11. Return a full run result as JSON.

Runtime preflight fails the run before `run.started` when a required host command or LLM access key is missing. The default `pi-agent` adapter checks the configured `pi` command; provider keys are not inferred for pi steps because pi manages its own auth. Real `opencode` and `claude-code` steps check their CLI commands, and known provider models require the matching `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`. Custom requirements can be declared with `taskSpec.payload.requiredEnv`.

Run `wfm doctor` to inspect host setup and adapter implementation status. Run `wfm doctor <workflow.md|workflow.json>` to validate a specific workflow's schema and runtime requirements without starting execution.

## State model

- Run statuses: `queued`, `running`, `waiting_for_approval`, `paused`, `succeeded`, `failed`, `cancelled`
- Step statuses: `pending`, `runnable`, `running`, `waiting_for_approval`, `succeeded`, `failed`, `cancelled`

## Confirmation model

- A step can require no validation, human validation, or external validation.
- Confirmation can come from:
  - `--auto-confirm-all`
  - `--confirm stepKey`
  - `--confirm stepKey:mode`
  - step-level `autoConfirm`
- Missing required confirmation transitions the run to `waiting_for_approval`.

## Retry and control routing

- `RETRY_CURRENT`: reruns the same step until `maxAttempts` is exceeded.
- `ROLLBACK_PREVIOUS`: resets current and previous step to `pending` and moves execution backward.
- `RESTART_ALL`: resets all steps and restarts from the first step.
