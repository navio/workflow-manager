# Workflow Schema

Workflow definitions are markdown files with YAML frontmatter.

## Top-level fields

- `key` (required)
- `title` (required)
- `description`
- `objectives` (array)
- `inputSchema`
- `outputSchema`
- `defaultRetryPolicy.maxAttempts`
- `steps` (required)

## Step fields

- `key`, `kind`, `objective`, `dependsOn`
- `validation.mode`: `none | human | external`
- `validation.required`, `validation.autoConfirm`
- `taskSpec.adapterKey`: `mock | opencode | codex | claude-code`
- `taskSpec.init.context`, `taskSpec.init.skills`, `taskSpec.init.mcps`, `taskSpec.init.systemPrompts`, `taskSpec.init.model`
- `taskSpec.payload.mockResult`: `success | retry | rollback | restart | yield | fail`
- `approvalSpec.autoApprove`, `approvalSpec.validation`
