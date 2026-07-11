# Runner API

`wfm run` now starts a local attach API for the lifetime of the running process.

The attach API lets a UI or local client inspect run status, per-step progress, loaded adapter config, and live agent output chunks without waiting for the final JSON result.

## CLI behavior

- `wfm run ./workflow.json --port 43121` binds the attach API to `127.0.0.1:43121`
- `wfm run ./workflow.json` binds to `127.0.0.1` on an OS-assigned free port
- `wfm run ./workflow.json --verbose` keeps the default live progress UI and also streams per-step agent output to stderr
- interactive human approvals now show an inline terminal prompt with a review summary; non-interactive or external waits can still be resolved through the attach API
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

### `GET /runs/:runId/events/list`

One-shot JSON poll over the same event history, designed for tool-calling agents that cannot hold an SSE stream open.

Query params:

- `sinceSequence` optional; only events with a higher sequence are returned
- `includeLogs=true|false` optional, defaults to `true`; `false` filters `agent.stdout` and `agent.stderr`

Response:

```json
{
  "items": [
    { "id": "...", "sequence": 4, "type": "step.execution_started", "runId": "run_123", "stepKey": "plan", "occurredAt": "...", "data": { "attempt": 1 } }
  ],
  "nextSequence": 4
}
```

`nextSequence` is the highest sequence in `items`, or the passed `sinceSequence` when no new events exist; pass it back as `sinceSequence` on the next poll.

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
- connection details resolve in priority order: `--url`/`--token` flags, then `--session-file`, then the environment variables

## Attach clients

`wfm run --session-file <path>` writes attach connection details to a JSON file (mode `0600`, parent directories created) as soon as the attach API is listening:

```json
{
  "baseUrl": "http://127.0.0.1:43121",
  "attachToken": "3b8c...",
  "runId": "run_123",
  "pid": 12345,
  "startedAt": "2026-05-02T19:00:00.000Z"
}
```

When the run finishes, the same file is rewritten with `endedAt` and the final `status`; it is never deleted. This lets a host agent start `wfm run` in the background and observe or control the run afterwards with plain CLI calls:

```bash
wfm run ./workflow.json --session-file ./run-session.json &
wfm status --session-file ./run-session.json
wfm status --session-file ./run-session.json --step review
wfm logs --session-file ./run-session.json --step review --limit 50
wfm events --session-file ./run-session.json --since 4
wfm approve --session-file ./run-session.json --step review
```

- `wfm status` prints the run snapshot (or one step detail with `--step`) as compact JSON on stdout
- `wfm logs` proxies `GET /runs/:runId/logs` and prints `{ "items": [...], "nextCursor": ... }`
- `wfm events` polls `GET /runs/:runId/events/list` once and prints `{ "items": [...], "nextSequence": ... }`; log events are excluded unless `--include-logs` is passed
- the read commands exit `0` whenever the API answered — a failed run status is data, not an error — and `1` only for connection or validation errors
- all attach commands accept `--url`/`--token`, `--session-file`, or the `WFM_RUNNER_URL`/`WFM_RUNNER_TOKEN` environment variables

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
