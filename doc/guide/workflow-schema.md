# Workflow Schema

Workflow definitions are Markdown files with YAML frontmatter.

The parser expects `key`, `title`, and `steps` at minimum.

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
- `taskSpec.adapterKey`: `mock | opencode | codex | claude-code`
- `taskSpec.init.context`
- `taskSpec.init.skills`
- `taskSpec.init.mcps`
- `taskSpec.init.systemPrompts`
- `taskSpec.init.model`
- `taskSpec.payload.mockResult`: `success | retry | rollback | restart | yield | fail`
- `approvalSpec.autoApprove`, `approvalSpec.validation`

## Validation rules enforced by the CLI

- step keys must be unique
- every dependency must reference an existing step
- `kind` must be one of `task`, `approval`, `system`
- adapter key must be one of the supported adapters
- validation mode must be `none`, `human`, or `external`
