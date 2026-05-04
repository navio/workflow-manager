# Runner API

`wfm run` now starts a local attach API for the lifetime of the running process.

The attach API lets a UI or local client inspect run status, per-step progress, loaded adapter config, and live agent output chunks without waiting for the final JSON result.

## CLI behavior

- `wfm run ./workflow.json --port 43121` binds the attach API to `127.0.0.1:43121`
- `wfm run ./workflow.json` binds to `127.0.0.1` on an OS-assigned free port
- the CLI prints the attach base URL and ephemeral bearer token to stderr before step execution starts
- `wfm run --json` includes a top-level `session` object with the same attach metadata

Example:

```bash
wfm run ./example-workflow.json --auto-confirm-all
# Attach API: http://127.0.0.1:43121 (token 3b8c...)
```

## Authentication

- bind address is always `127.0.0.1`
- every endpoint except `/health` requires `Authorization: Bearer <token>`
- the token is generated per run and is never persisted

## Endpoints

### `GET /health`

Returns process-level liveness.

```json
{ "ok": true }
```

### `GET /session`

Returns attach session metadata.

```json
{
  "sessionId": "f7d8...",
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 43121,
  "baseUrl": "http://127.0.0.1:43121",
  "startedAt": "2026-05-02T19:00:00.000Z",
  "run": {
    "runId": "run_123",
    "workflowKey": "example",
    "workflowTitle": "Example Workflow",
    "status": "running"
  }
}
```

### `GET /runs/:runId`

Returns the latest run snapshot.

Fields include:

- run status
- current step key
- workflow objective and objectives
- waiting-for-approval reason when applicable
- per-step status, attempt count, timestamps, and adapter

### `GET /runs/:runId/steps/:stepKey`

Returns one step detail record, including config summary.

Config fields include:

- `model`
- `skills`
- `mcps`
- `systemPrompts`
- `contextSummary`

### `GET /runs/:runId/logs`

Returns buffered stdout/stderr chunks.

Query params:

- `stepKey` optional
- `limit` optional, defaults to `200`
- `cursor` optional numeric offset

### `GET /runs/:runId/events`

Server-sent events stream with historical replay followed by live events.

Query params:

- `sinceSequence` optional
- `includeLogs=true|false` optional, defaults to `true`

### `POST /runs/:runId/approve`

Approves the currently waiting step and lets execution continue.

Optional body:

```json
{ "stepKey": "review" }
```

Optional metadata fields:

- `actor`
- `note`
- `source`

### `POST /runs/:runId/resume`

Alias of `approve` for clients that treat approval and external resume as the same action.

### `POST /runs/:runId/cancel`

Cancels the waiting run.

Optional body:

```json
{ "stepKey": "review" }
```

## CLI control commands

The CLI can call the attach API directly:

```bash
wfm approve --url http://127.0.0.1:43121 --token <token> --step review --actor alice --note "LGTM"
wfm resume --url http://127.0.0.1:43121 --token <token> --step review --actor alice
wfm cancel --url http://127.0.0.1:43121 --token <token> --step review --actor alice --note "stop this run"
```

Notes:

- `--run-id` is optional; if omitted, the CLI reads it from `GET /session`
- `--url` can also be provided via `WFM_RUNNER_URL`
- `--token` can also be provided via `WFM_RUNNER_TOKEN`

## Event stream

The current implementation emits the existing workflow events plus agent output events:

- `run.created`
- `run.started`
- `run.waiting_for_approval`
- `run.completed`
- `run.failed`
- `step.runnable`
- `step.claimed`
- `step.execution_started`
- `step.execution_finished`
- `step.waiting_for_approval`
- `step.confirmed`
- `step.retried`
- `agent.started`
- `agent.stdout`
- `agent.stderr`
- `agent.finished`

Example SSE frame:

```text
event: step.execution_started
id: 4
data: {"id":"...","sequence":4,"type":"step.execution_started","runId":"run_123","stepKey":"plan","occurredAt":"2026-05-02T19:00:01.000Z","data":{"attempt":1}}
```

## Notes

- the API is in-memory and ephemeral; it disappears when the `wfm run` process exits
- `mock` steps do not emit stdout/stderr chunks
- `claude-code` and real `opencode` steps can emit live log chunks through `agent.stdout` and `agent.stderr`
- approval and cancel actions only work while the run is in `waiting_for_approval`
- approval audit events include optional actor, note, and source metadata when provided
- secrets are not persisted by the attach API, and step context is summarized instead of exposing raw context objects by default
