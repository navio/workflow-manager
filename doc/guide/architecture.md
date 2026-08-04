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
- Runtime preflight before execution for host-installed adapter clients and LLM access keys
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

1. Use `pi-agent` as the default task adapter when `taskSpec.adapterKey` is omitted.
2. Keep `mock` for local simulation and tests.
3. Add adapter executors behind a common execution interface.
4. Route execution by resolved `taskSpec.adapterKey`.
5. Preserve `InputEnvelope`/`OutputEnvelope` compatibility to keep engine logic unchanged.

This allows the `pi` coding agent and real `opencode`, `codex`, `claude-code`, `kimi`, `gemini`, or `qwen` executors to share workflow definitions.

Real adapter execution is intentionally fail-fast. Before the first step starts, the runner checks that required host commands are installed and that provider-specific environment variables inferred from configured models are present. Default `pi-agent` steps only check the `pi` command itself, because pi manages provider credentials in its own auth store.

## Runner observability telemetry contract

`src/remote/observability.ts` defines the versioned (`schemaVersion: 2`) telemetry contract sent
by `wfm run` when the caller is authenticated and has not opted out (`WFM_TELEMETRY=off`):

- `RunTelemetryPayloadV2`: one row per run — timing, terminal state, step counts, requested
  adapter/model per step, and (for pulled workflows only) an immutable namespace/version link.
  See `src/remote/workflowProvenance.ts` for how that link is derived.
- `StepTelemetryPayload`: one record per executed step attempt — adapter, requested model,
  lifecycle timestamps, and duration. Approval/system steps never carry an adapter or model.
- `serializeRunTelemetryPayloadV2` is an allow-list serializer: it reconstructs the payload
  field-by-field from the typed contract, so it is structurally impossible for raw workflow
  input/output, prompts, logs, hostnames, filesystem paths, or tokens to reach the network,
  regardless of what upstream code accidentally attaches to the in-memory object.
- The engine (`src/engine.ts`) is the sole source of the timing/adapter/model fields — the CLI
  never infers them from UI-only events.

Full product/privacy contract, retention policy, and opt-out instructions: `doc/guide/observability.md`.

## Related docs

- ERD and persistence model: [ERD](/guide/erd)
- protocol contract between orchestrator and steps: [Protocol](/guide/protocol)
