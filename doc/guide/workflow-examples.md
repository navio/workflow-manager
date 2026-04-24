# Workflow Examples

## Minimal workflow

```md
---
key: minimal-demo
title: Minimal Demo
steps:
  - key: plan
    kind: task
    taskSpec:
      adapterKey: mock
      payload:
        mockResult: success
---
```

## Multi-step workflow with approval and retries

```md
---
key: release-flow
title: Release Flow
description: Build, verify, and approve a release
objectives:
  - keep release quality high
  - require explicit human approval before ship
defaultRetryPolicy:
  maxAttempts: 2
steps:
  - key: build
    kind: task
    objective: Build and run automated checks
    validation:
      mode: external
      required: true
      autoConfirm: false
    taskSpec:
      adapterKey: codex
      init:
        skills: [coding, testing]
        systemPrompts: [Prefer small, reviewable changes]
      payload:
        mockResult: success

  - key: qa_gate
    kind: approval
    dependsOn: [build]
    approvalSpec:
      autoApprove: false
      validation:
        mode: human
        required: true
        autoConfirm: false

  - key: publish
    kind: task
    dependsOn: [qa_gate]
    retryPolicy:
      maxAttempts: 3
    taskSpec:
      adapterKey: opencode
      init:
        skills: [release-management]
      payload:
        mockResult: success
---
```

## Run examples

```bash
# Validate structure
wfm validate ./release-flow.md

# Run with explicit confirmations
wfm run ./release-flow.md --confirm build:external,qa_gate:human

# Fast path for local testing
wfm run ./release-flow.md --auto-confirm-all
```

## Implementation patterns

- Use `approval` steps for product or compliance gates.
- Use `validation.mode: external` for machine-mediated checks.
- Keep adapter setup in `taskSpec.init` to avoid hardcoding runtime context.
- Prefer small, single-purpose steps so retries and rollbacks stay predictable.
