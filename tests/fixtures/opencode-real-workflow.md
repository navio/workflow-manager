---
key: opencode-real-workflow
title: OpenCode Real Workflow
description: Runs a real opencode command when useRealAdapter is enabled.
defaultRetryPolicy:
  maxAttempts: 1
steps:
  - key: opencode_probe
    kind: task
    objective: Execute a real opencode smoke command
    validation:
      mode: none
      required: false
      autoConfirm: true
    taskSpec:
      adapterKey: opencode
      payload:
        useRealAdapter: true
        opencodeSmokeTest: true
        opencodeArgs: [--version]
        expectPattern: "\\d+\\.\\d+\\.\\d+"
        timeoutMs: 15000
---

# OpenCode Real Workflow Fixture

Used by optional e2e tests that execute the real opencode CLI.
