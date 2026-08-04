# Runner Observability

`wfm run` can send privacy-safe, versioned telemetry so workflow creators and runners get
actionable health, timing, and runtime-adoption visibility — without ever exposing another
user's identity, raw data, or individual run history.

## What is collected

For each run, when telemetry is enabled and the CLI is authenticated (`wfm auth login`):

- **Run summary:** workflow key/title, an immutable SHA-256 fingerprint of the parsed
  workflow definition, terminal state (`succeeded` / `failed` / `waiting_for_approval` /
  `cancelled`), start/end timestamps, total duration, step counts (succeeded/failed/
  waiting/cancelled/retried), an effectiveness score, CLI version, and runner platform
  (`darwin` / `linux` / `win32`).
- **Provenance (pulled workflows only):** the namespace/version UUIDs and version label of
  the exact remote version pulled, so cross-user comparisons are meaningful. A workflow
  that was hand-authored, or a pulled workflow that was subsequently edited locally, is
  reported as `workflowOrigin: "local"` with no namespace/version attached.
- **Per-step records:** step key, kind (`task` / `approval` / `system`), attempt number,
  terminal status, the resolved adapter (e.g. `pi-agent`, `mock`, `opencode`), the
  requested model (or `null` if none was configured), and lifecycle timestamps/duration.
  Approval and system steps never carry an adapter or model.
- **Failure classification:** a bounded, stable category (`validation`, `preflight`,
  `adapter`, `execution`, `approval`, `cancelled`, `unknown`) plus a length-capped, generic
  reason string — never a raw error object, stack trace, or provider response body.

## What is never collected

wfm's telemetry contract is an **allow-list**, not a blacklist: the payload sent over the
network is reconstructed field-by-field from a fixed shape
(`RunTelemetryPayloadV2` in `src/remote/observability.ts`), so it is structurally
impossible for any of the following to leak, regardless of what other in-memory state
happens to be nearby:

- Raw workflow inputs, outputs, or step payloads.
- Prompts, system prompts, or skill contents.
- MCP endpoint URLs.
- stdout/stderr or any other log content.
- Approval notes.
- Hostnames, IP addresses, or a stable device fingerprint.
- Filesystem paths (workflow file names/paths are never transmitted).
- Token values or other credentials.
- Another user's ID, username, or individual run history.

## Default, opt-out, and precedence

Telemetry is **default-enabled** for authenticated runs. Unauthenticated runs never send
telemetry, regardless of preference.

```bash
wfm telemetry status  # show the current effective preference
wfm telemetry off      # persist a local opt-out (writes to the CLI config file)
wfm telemetry on       # re-enable
WFM_TELEMETRY=off wfm run ./workflow.json   # one-off override for a single invocation
```

Precedence, highest to lowest: the `WFM_TELEMETRY` environment variable, then the
persisted `wfm telemetry on|off` preference, then the "on" default. Telemetry preference
is never read from or written to a workflow definition file.

Telemetry is best-effort and cannot affect your run: transport failures print at most one
warning to stderr and never change the workflow's exit code or touch `--json` stdout.

## Retention and deletion

- Raw run/step telemetry rows are retained for **90 days**, then deleted by a scheduled
  job after being rolled up.
- Daily aggregate rollups (counts, rates, percentiles — no user identifiers) are retained
  for **13 months** to support longer-window benchmarking.
- To request deletion of your raw telemetry before the retention window elapses, contact
  the registry operator through the hosted web app; deleting your account removes all
  associated raw rows (aggregates remain, but contain no identifying information).

## What you can see

**My runs (owner-only):** your own recent runs and detailed per-step timing for workflows
you executed, drawn from raw telemetry within the 90-day retention window.

**Creator observability (namespaces you own):** for a published workflow/version you own,
aggregate run health, duration percentiles (p50/p95), retry/approval rates, a
runtime/model adoption breakdown, and a step hotspot table — computed server-side from
daily rollups, never from row-level peer data.

**Anonymous community benchmark:** aggregate counts/rates/percentiles across *distinct
authenticated users* running the same published workflow/version. A segment is only ever
returned once it contains data from at least **5 distinct users** (`k = 5` anonymity
threshold); below that, the API returns `{ suppressed: true, minimumCohort: 5 }` and the
UI shows a neutral "not enough anonymous usage yet" state — never a zero-valued chart, and
never a peer's individual run, identity, or ranking.

## Interpreting the numbers

- **Requested model** is the model configured for a step (`taskSpec.init.model`), not a
  provider-verified value — an adapter may resolve or substitute a different model at
  runtime.
- **Effectiveness score** is a heuristic (0–100) combining success ratio, retry cost,
  approval waits, and failures; it is not a correctness guarantee.
- **p50/p95** are percentile durations across the selected window (7/30/90 days) computed
  with `percentile_cont` over rollup data, not the raw per-run distribution.
- **Success rate** is the share of terminal runs that reached `succeeded`.

## Operational deployment order

1. Apply Supabase migrations (schema + retention job).
2. Deploy the ingestion Edge Function (`track-run-telemetry`), with V1 payload
   compatibility retained for the transition window.
3. Deploy the aggregate API (`workflow-observability`); verify ownership checks,
   suppression, and query performance.
4. Release the CLI's V2 emitter.
5. Deploy the remote registry observability UI once real V2 data is available.
6. After one supported CLI release cycle, remove V1 ingestion compatibility.

**Rollback:** disable V2 emission (e.g. via `WFM_TELEMETRY=off` guidance or a server-side
kill switch on the ingestion function) without affecting workflow execution, and hide the
observability route. Raw tables are never dropped and RLS is never loosened as a rollback
mechanism.
