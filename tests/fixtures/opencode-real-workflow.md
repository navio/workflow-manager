---
key: opencode-real-workflow
title: OpenCode Real Workflow
description: Drives the real opencode agent through ACP (opencode acp) with no opt-in flags.
defaultRetryPolicy:
  maxAttempts: 1
steps:
  - key: opencode_probe
    kind: task
    objective: Reply with exactly the single word ACK
    validation:
      mode: none
      required: false
      autoConfirm: true
    taskSpec:
      adapterKey: opencode
      payload:
        prompt: "Reply with exactly: ACK"
        acpPermissions: reads-only
        timeoutMs: 120000
---

# OpenCode Real Workflow Fixture

Used by optional e2e tests that execute the real opencode CLI.
