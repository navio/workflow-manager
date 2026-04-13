# Protocol

This project follows an ATEP-style (Agentic Task Execution Protocol) contract so the orchestration loop stays adapter-agnostic.

## Overview

Every step consumes a canonical input envelope and produces a canonical output envelope. The engine uses only these contracts to decide transitions.

- input provides global objective, step context, and priming config
- output provides execution status, QA routing action, and payload mutations
- routing actions drive retry, rollback, restart, or progression

## Input envelope

In this repo, the input contract is represented by `InputEnvelope` in `src/types.ts`.

```json
{
  "global_context": {
    "workflow_id": "string",
    "primary_objective": "string",
    "workflow_objectives": ["string"],
    "global_state": {}
  },
  "step_context": {
    "step_id": "string",
    "step_objective": "string",
    "previous_output": {},
    "assigned_node_type": "AGENT | HUMAN | SYSTEM"
  },
  "priming_configuration": {
    "required_skills": ["string"],
    "mcp_endpoints": ["string"],
    "system_prompts": ["string"],
    "context": {},
    "adapter": "mock | opencode | codex | claude-code",
    "model": "string"
  }
}
```

## Output envelope

In this repo, the output contract is represented by `OutputEnvelope` in `src/types.ts`.

```json
{
  "step_id": "string",
  "execution_status": "SUCCESS | QA_REJECTED | YIELD_EXTERNAL | FAILED",
  "qa_routing": {
    "action": "PROCEED | RETRY_CURRENT | ROLLBACK_PREVIOUS | RESTART_ALL",
    "feedback_reason": "string"
  },
  "mutated_payload": {},
  "metadata": {
    "execution_time_ms": 0,
    "external_intervention_required": false,
    "intervention_details": {}
  }
}
```

## Routing semantics

- `PROCEED`: mark step succeeded and move forward
- `RETRY_CURRENT`: rerun current step until max attempts
- `ROLLBACK_PREVIOUS`: reset current + previous and move index backward
- `RESTART_ALL`: reset all steps and restart from the first step

## Human and external intervention

- `validation.mode` can be `none`, `human`, or `external`
- if confirmation is required and not provided, run moves to `waiting_for_approval`
- `YIELD_EXTERNAL` indicates the run should pause for non-agent input
- once intervention is resolved, execution can resume with updated state

## Why this contract matters

- execution backends are replaceable as long as they speak the same envelope
- workflow logic remains independent from ACP/vendor transport details
- eventing and audit logs stay consistent across adapter implementations
