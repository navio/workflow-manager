# How It Works

`workflow-manager` turns a Markdown workflow definition into a deterministic run.

## Execution flow

1. Parse Markdown frontmatter into a `WorkflowDefinition`.
2. Validate schema-level constraints (keys, dependencies, adapters, validation modes).
3. Initialize run state (`queued` -> `running`) and create a `StepRun` for each step.
4. Execute steps in order, enforcing `dependsOn` before each step starts.
5. Build an input envelope with global state, step context, and adapter init data.
6. Execute the step (currently through the mock executor).
7. Apply validation and confirmation policy.
8. Resolve routing actions (`RETRY_CURRENT`, `ROLLBACK_PREVIOUS`, `RESTART_ALL`, or proceed).
9. Record run and step events in sequence.
10. Return a full run result as JSON.

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
