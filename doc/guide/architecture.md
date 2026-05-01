# Architecture

This project uses a focused CLI implementation today, while preserving boundaries that map to a larger orchestration platform architecture.

## General overview

The architecture follows a layered model:

- authoring and validation: define workflows and verify constraints
- orchestration: decide step order, retries, rollback, and pause/resume behavior
- execution: invoke adapter-specific runtime behavior
- observability: track events, outcomes, and audit history

For now, these layers run in-process inside the CLI. The contracts are separated so they can be split into services later without rewriting workflow definitions.

## Module map

- `src/index.ts`: CLI entrypoint and command dispatch
- `src/parser.ts`: Markdown parsing and workflow validation
- `src/engine.ts`: run loop, state transitions, dependency checks, retries, confirmations
- `src/mockExecutor.ts`: deterministic step execution simulator
- `src/events.ts`: append-only event log for run telemetry
- `src/types.ts`: workflow, envelope, run result, and event contracts

## Data contracts

- `WorkflowDefinition`: normalized in-memory representation of frontmatter
- `InputEnvelope`: data passed to a step executor
- `OutputEnvelope`: structured result returned by a step executor
- `RunResult`: final output returned by `wfm run`

## Runtime design choices

- In-memory state for fast local iteration
- Ordered step traversal with explicit dependency checks
- Event-sourced timeline for traceability
- Adapter-agnostic step contracts so execution backends can be swapped

## Boundary model (target shape)

The intended platform shape, adapted from the architecture notes, is a modular monolith with clear package boundaries:

- API surface: command/query endpoints for start, validate, approve, resume, and inspect
- Orchestrator worker: heartbeat claiming, retries, status transitions, pause/resume
- Workflow engine: DAG semantics, readiness checks, routing decisions
- Runtime task layer: sandbox and execution envelope handling
- Adapter gateway: dispatch by adapter type and capability checks
- Persistence and observability: durable state, events, artifacts, and cost tracking

This repository already aligns to the same seam lines through `types`, `parser`, `engine`, and executor abstraction.

## Ways to implement execution backends

1. Keep `mock` for local simulation and tests.
2. Add adapter executors behind a common execution interface.
3. Route execution by `taskSpec.adapterKey`.
4. Preserve `InputEnvelope`/`OutputEnvelope` compatibility to keep engine logic unchanged.

This allows adding real `opencode`, `codex`, or `claude-code` executors without changing workflow definitions.

## Related docs

- ERD and persistence model: [ERD](/guide/erd)
- protocol contract between orchestrator and steps: [Protocol](/guide/protocol)
