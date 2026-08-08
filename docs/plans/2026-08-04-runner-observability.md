# Runner Observability Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Give workflow creators actionable run, step, agent, model, and timing visibility for their workflows, while exposing other users’ activity only as privacy-safe aggregate benchmark statistics.

**Architecture:** Extend the existing authenticated CLI `track-run-telemetry` pipeline into a versioned, idempotent **run summary + step execution** event contract. The runner derives telemetry only from execution metadata already available in `RunResult.events` and workflow configuration, batches it at terminal run completion, and sends it best-effort to Supabase. Supabase retains owner-identifiable raw telemetry only for the executing user; creator-facing cross-user analytics are returned only through aggregate queries that enforce a minimum cohort threshold and never return user IDs, token IDs, host details, raw input/output, prompts, logs, or run IDs.

**Tech Stack:** Bun, TypeScript, `bun:test`, Supabase/Postgres migrations and Edge Functions, React, TanStack Query, Vite, VitePress.

---

## Product and privacy contract

### Questions this feature answers

For a creator’s published workflow/version, the dashboard must show:

- **Run health:** total runs, terminal-state counts, success rate, effectiveness score, retries, approval waits, and failure categories.
- **Latency:** total duration plus p50/p95 run duration; step-level p50/p95 execution time and contribution to total run time.
- **Runtime adoption:** which runner adapters/agents (`pi-agent`, `claude-code`, `codex`, `opencode`, `acp`, etc.) and requested models are being used.
- **Quality by runtime:** success/effectiveness, retries, and duration segmented by `(agent_adapter, model)`.
- **Version comparison:** performance for the exact published workflow version used by a remote pull, not merely by mutable workflow key.
- **Anonymous community benchmarks:** aggregate counts/rates/percentiles across distinct users running the same published workflow/version; no peer identity or run-level peer data.

### Explicit privacy requirements

1. **Never collect:** raw workflow inputs, outputs, prompts/system prompts, skill contents, MCP endpoint URLs, stdout/stderr, approval notes, hostnames, paths, token values, IP addresses, or a stable device fingerprint.
2. **Raw run rows remain private to the authenticated executor.** The existing `actor_user_id` remains server-only and is never selected in a creator/benchmark response.
3. **Cross-user results are aggregate-only and thresholded.** Do not emit an aggregate segment until it contains at least `k = 5` distinct authenticated users. Return `null`/`suppressed` rather than a low-count value; do not round a one-user result into apparent anonymity.
4. **No user comparison or ranking.** The dashboard may say “community benchmark (anonymous)” but never list, link, count per individual, or show another user’s individual run history.
5. **Creator scope is explicit.** A creator can see aggregates only for namespaces they own. A user can still see their own detailed telemetry under “My runs.”
6. **Telemetry participation is transparent and controllable.** Authenticated clients receive a documented default-enabled, local opt-out (`WFM_TELEMETRY=off` and persisted CLI preference); anonymous/unauthed runs send nothing. Before implementation, product/legal must approve whether default-enabled is acceptable or the default changes to opt-in.
7. **Retention policy:** retain raw telemetry for 90 days, roll up daily aggregates for 13 months, then delete raw rows via a scheduled Supabase job. Document this policy and the user deletion path.

### Non-goals for v1

- OpenTelemetry collector/exporter integration, distributed traces, real-time dashboards, cost/token reporting, trace/span sampling, arbitrary BI querying, peer leaderboards, or a public analytics endpoint.
- Claiming provider-reported model usage. `model` is the **requested/configured model** unless an adapter later returns verified provider metadata.

---

## Proposed telemetry model

### Run summary (one row per `run_id`)

Add immutable, normalized fields to `workflow_run_telemetry`:

```ts
interface RunTelemetryPayloadV2 {
  schemaVersion: 2;
  runId: string; // idempotency key within an authenticated user
  workflowKey: string;
  workflowTitle: string | null;
  workflowFingerprint: string; // SHA-256 of canonical parsed definition, not source path/content
  workflowNamespaceId: string | null; // populated only for an authenticated remote-origin match
  workflowVersionId: string | null; // populated only for exact pulled version
  workflowVersionLabel: string | null;
  workflowOrigin: "remote" | "local";
  terminalState: "succeeded" | "failed" | "waiting_for_approval" | "cancelled";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  // Existing step status/effectiveness summary fields remain.
  cliVersion: string | null;
  runnerPlatform: "darwin" | "linux" | "win32" | "unknown";
  failureCategory: "validation" | "preflight" | "adapter" | "execution" | "approval" | "cancelled" | "unknown" | null;
  failureReason: string | null; // capped/sanitized, no raw remote/provider payload
  steps: StepTelemetryPayload[];
}

interface StepTelemetryPayload {
  stepKey: string;
  stepKind: "task" | "approval" | "system";
  attempt: number;
  terminalStatus: "succeeded" | "failed" | "waiting_for_approval" | "cancelled";
  adapter: AdapterKey | "approval" | "system";
  requestedModel: string | null;
  startedAt: string | null;
  endedAt: string | null;
  executionDurationMs: number | null;
  queueDurationMs: number | null;
  executionStatus: ExecutionStatus | null;
  qaAction: QaAction | null;
}
```

### Server-side aggregate response

Return only summaries such as:

```ts
interface WorkflowObservabilityResponse {
  workflow: { slug: string; versionLabel: string | null };
  owner: AggregateWindow;
  community: AggregateWindow & {
    distinctUsers: number | null;
    suppressed: boolean;
    minimumCohort: 5;
  };
  byRuntime: Array<{
    adapter: string;
    requestedModel: string | null;
    totalRuns: number;
    successRate: number;
    averageDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    suppressed: boolean;
  }>;
  steps: Array<{
    stepKey: string;
    adapter: string;
    requestedModel: string | null;
    totalExecutions: number;
    successRate: number;
    p50ExecutionDurationMs: number;
    p95ExecutionDurationMs: number;
    suppressed: boolean;
  }>;
}
```

The API must omit/suppress any segment that fails the `k=5 distinct users` rule. Owner-only detail may show the owner’s own recent runs, but community/creator responses never include `run_id`, `actor_user_id`, timestamps precise enough to identify a peer run, or any row-level peer record.

---

### Task 1: Establish telemetry vocabulary, privacy guardrails, and fixtures

**Objective:** Make the data contract explicit before changing the runner or database.

**Files:**
- Create: `src/remote/observability.ts`
- Create: `tests/observability.test.ts`
- Modify: `src/types.ts: RunResult, StepRun, RunEvent`
- Modify: `src/remote/api.ts: RunTelemetryPayload`
- Modify: `doc/guide/architecture.md`
- Modify: `supabase/README.md`

**Step 1: Write failing contract tests**

Cover:
- a completed task step produces adapter, requested model, attempt, lifecycle timestamps, and duration;
- task steps without a configured model emit `requestedModel: null`;
- approval/system steps never claim an agent/model;
- serialized payload rejects/sanitizes prohibited keys (`input`, `output`, `prompt`, `log`, `hostname`, `path`, `token`);
- failure reasons are length-capped and mapped to stable categories.

**Step 2: Run the test to verify failure**

Run: `bun test tests/observability.test.ts`

Expected: FAIL because the V2 telemetry builders and types do not exist.

**Step 3: Add minimal shared contracts**

- Add `TelemetrySchemaVersion = 2`, `WorkflowOrigin`, `FailureCategory`, and telemetry-only interfaces.
- Do **not** put telemetry fields into workflow definition JSON; telemetry is runner/server transport state.
- Add an allow-list serializer for telemetry values, rather than a fragile blacklist. Permit only scalars and fixed arrays/objects specified by `RunTelemetryPayloadV2`.
- Add `classifyFailure(errorOrReason, terminalState)` that returns a bounded stable category and a capped generic message.

**Step 4: Verify passing tests**

Run: `bun test tests/observability.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/types.ts src/remote/observability.ts src/remote/api.ts tests/observability.test.ts doc/guide/architecture.md supabase/README.md
git commit -m "feat: define privacy-safe runner observability contract"
```

### Task 2: Preserve per-attempt timing and runtime identity in the engine

**Objective:** Ensure the final run result contains machine-readable telemetry rather than requiring the CLI to infer timings from UI-only events.

**Files:**
- Modify: `src/types.ts: StepRun and RunResult`
- Modify: `src/engine.ts: step execution lifecycle and final result`
- Modify: `src/runnerSession.ts: step snapshot projection`
- Modify: `tests/engine.test.ts`
- Modify: `tests/runnerSession.test.ts` (or create it if absent)

**Step 1: Write failing engine tests**

Use the mock adapter and assert:

```ts
expect(result.startedAt).toMatch(/T/);
expect(result.endedAt).toMatch(/T/);
expect(result.stepRuns[0]).toMatchObject({
  stepKey: "plan",
  adapter: "mock",
  requestedModel: "test-model",
  startedAt: expect.any(String),
  endedAt: expect.any(String),
  executionDurationMs: expect.any(Number),
});
```

Add retry coverage proving attempts are represented as separate attempt records (or an `attempts` array) rather than a single final duration that loses retry cost.

**Step 2: Run focused tests and confirm failure**

Run: `bun test tests/engine.test.ts tests/runnerSession.test.ts`

Expected: FAIL because `StepRun` only has `stepKey/status/attempt/confirmed/output`.

**Step 3: Implement lifecycle capture at the authoritative source**

- Add `startedAt` when a step is claimed, `endedAt` after its executor returns, and `executionDurationMs` based on the executor window.
- Record resolved adapter and requested model from the `InputEnvelope`/step config at execution start.
- Preserve each attempted execution in a bounded `attempts` structure; summarize the final attempt into existing `StepRun` fields for backward compatibility.
- Record run `startedAt`/`endedAt` in `RunResult` at `runWorkflow` level.
- Keep logs, prompts, outputs, and adapter payloads outside telemetry-specific fields.
- Update runner session snapshots only if they need the newly normalized values; avoid changing attach API semantics unnecessarily.

**Step 4: Verify focused tests pass**

Run: `bun test tests/engine.test.ts tests/runnerSession.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/types.ts src/engine.ts src/runnerSession.ts tests/engine.test.ts tests/runnerSession.test.ts
git commit -m "feat: record per-step runtime and duration metadata"
```

### Task 3: Attribute remote runs to an immutable workflow version

**Objective:** Make cross-user comparisons meaningful by linking a run to the remote registry version actually pulled, without exposing source content or file paths.

**Files:**
- Modify: `src/remote/pull.ts` (or the existing pull/write implementation discovered in `src/index.ts` / `src/remote/`)
- Create: `src/remote/workflowProvenance.ts`
- Modify: `src/index.ts: cmdPull and cmdRun`
- Modify: `src/remote/telemetry.ts`
- Modify: `tests/remote.test.ts`
- Modify: `tests/run-telemetry.test.ts`

**Step 1: Write failing provenance tests**

Test that `wfm pull owner/workflow --output workflow.json` creates an adjacent private provenance sidecar, for example `workflow.json.wfm-provenance.json`, containing only:

```json
{
  "schemaVersion": 1,
  "namespaceId": "uuid",
  "workflowVersionId": "uuid",
  "versionLabel": "v1.2.0",
  "workflowFingerprint": "sha256:..."
}
```

Test that `wfm run` uses matching sidecar provenance only when the canonical definition fingerprint matches. A modified local file must emit `workflowOrigin: "local"` and omit namespace/version identifiers.

**Step 2: Run focused tests and confirm failure**

Run: `bun test tests/remote.test.ts tests/run-telemetry.test.ts`

Expected: FAIL because pull/run provenance does not exist.

**Step 3: Implement provenance safely**

- Canonicalize only parsed workflow definition fields and hash the canonical JSON with SHA-256.
- Save sidecars with mode `0600` where supported; never store auth tokens, owner identity, URL, original source, or user input.
- Add `resolveWorkflowProvenance(workflowPath, definition)` that treats a missing, unreadable, invalid, or mismatched sidecar as local/unattributed—never as an error that blocks execution.
- Ensure `--output` pull behavior and existing workflow files remain backward compatible.

**Step 4: Verify passing tests**

Run: `bun test tests/remote.test.ts tests/run-telemetry.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/remote/workflowProvenance.ts src/remote/telemetry.ts src/index.ts tests/remote.test.ts tests/run-telemetry.test.ts
git commit -m "feat: attribute pulled workflow runs to immutable versions"
```

### Task 4: Produce and transmit V2 telemetry with explicit user control

**Objective:** Send a privacy-safe, idempotent batch of run and step telemetry only when permitted.

**Files:**
- Modify: `src/remote/telemetry.ts`
- Modify: `src/remote/api.ts`
- Modify: `src/remote/config.ts`
- Modify: `src/index.ts: cmdRun`
- Modify: `src/manPage.ts`
- Modify: `tests/run-telemetry.test.ts`
- Modify: `tests/remote.test.ts`
- Modify: `doc/guide/getting-started.md`
- Modify: `doc/guide/architecture.md`

**Step 1: Write failing tests**

Cover:
- V2 payload includes run timing, provenance, and per-attempt step records;
- run ID is sent as the idempotency key;
- no telemetry network request occurs for unauthenticated runs or `WFM_TELEMETRY=off`;
- a telemetry failure logs one non-secret warning and cannot change the workflow exit code;
- `--json` stdout stays unchanged/machine-readable, with warnings on stderr only.

**Step 2: Run tests to verify failure**

Run: `bun test tests/run-telemetry.test.ts tests/remote.test.ts tests/runnerCli.test.ts`

Expected: FAIL because V2 emission/configuration is absent.

**Step 3: Implement the minimal transport behavior**

- Replace the V1-only payload builder with `buildRunTelemetryPayloadV2` while retaining a server-compatible fallback only for the transition release if necessary.
- Use engine-recorded timestamps/durations rather than a CLI-only wall clock except for preflight failures where no `RunResult` exists.
- Add `WFM_TELEMETRY=off` / `on` parsing in `src/remote/config.ts`; document precedence and default. Do not add a flag that risks placing telemetry preference in workflow files.
- Send `Idempotency-Key: <actor-independent run UUID>` (or include `runId` under a server-side unique constraint) so retries never double-count.
- Keep payload construction in a dedicated module and do not send `RunResult` wholesale.

**Step 4: Verify passing tests**

Run: `bun test tests/run-telemetry.test.ts tests/remote.test.ts tests/runnerCli.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/remote/telemetry.ts src/remote/api.ts src/remote/config.ts src/index.ts src/manPage.ts tests/run-telemetry.test.ts tests/remote.test.ts doc/guide/getting-started.md doc/guide/architecture.md
git commit -m "feat: emit privacy-safe versioned runner telemetry"
```

### Task 5: Migrate Supabase for raw telemetry, step attempts, rollups, and retention

**Objective:** Store telemetry efficiently, prevent duplicate run inserts, and make owner/community aggregate queries scalable.

**Files:**
- Create: `supabase/migrations/<timestamp>_runner_observability.sql`
- Create: `supabase/migrations/<timestamp>_runner_observability_retention.sql`
- Modify: `supabase/README.md`
- Modify: `tests/supabase-functions.test.ts`

**Step 1: Write database/function-level failing tests**

Add handler dependency tests proving:
- duplicate `(actor_user_id, run_id)` inserts are idempotent;
- a run can contain multiple step-attempt rows;
- a remote workflow version can be linked only to a namespace/version that exists;
- raw rows are not returned from creator/community endpoints;
- a cohort with fewer than five distinct users is suppressed.

**Step 2: Add the migration**

Create/alter the schema:

```sql
alter table public.workflow_run_telemetry
  add column schema_version smallint not null default 1,
  add column workflow_fingerprint text,
  add column workflow_origin text not null default 'local',
  add column workflow_namespace_id uuid references public.workflow_namespaces(id),
  add column workflow_version_id uuid references public.workflow_versions(id),
  add column workflow_version_label text,
  add column started_at timestamptz,
  add column ended_at timestamptz,
  add column runner_platform text,
  add column failure_category text;

create unique index workflow_run_telemetry_actor_run_id_uidx
  on public.workflow_run_telemetry (actor_user_id, run_id);

create table public.workflow_step_telemetry (...);
create table public.workflow_observability_daily_rollups (...);
```

Implementation requirements:

- Check constraints for enumerated values and non-negative durations.
- Foreign keys must be nullable for local/unattributed runs.
- Add indexes optimized for `(workflow_namespace_id, workflow_version_id, created_at)`, `(actor_user_id, created_at)`, and step aggregation dimensions.
- Do **not** add a client-select RLS policy for raw step rows. Edge Functions use the service role and implement authorization themselves.
- Use a transactional database RPC or Edge Function transaction equivalent: run summary upsert and all step inserts succeed/fail together.
- Create a daily rollup function/job that calculates counts, `count(distinct actor_user_id)`, rates, average, and PostgreSQL `percentile_cont(0.5/0.95)` per workflow/version/adapter/model/step. Store no actor IDs in rollups.
- Add a scheduled retention function that deletes raw step/run rows older than 90 days after rollup completion; test its selection predicate with fixtures or SQL-level integration test.

**Step 3: Run local migration and database checks**

Run:

```bash
bun run supabase:start
bun run supabase:db:reset
bun run supabase:db:lint
bun run supabase:test
```

Expected: migration applies cleanly and Supabase tests pass.

**Step 4: Commit**

```bash
git add supabase/migrations supabase/README.md tests/supabase-functions.test.ts
git commit -m "feat: persist aggregated runner observability telemetry"
```

### Task 6: Upgrade telemetry ingestion with validation and idempotency

**Objective:** Accept only the allow-listed V2 contract and persist it atomically.

**Files:**
- Modify: `supabase/functions/track-run-telemetry/handler.ts`
- Modify: `supabase/functions/_shared/ops.ts` only if operation metadata needs a safe summary
- Modify: `supabase/config.toml` if function configuration needs adjustment
- Modify: `tests/supabase-functions.test.ts`
- Modify: `src/remote/api.ts`

**Step 1: Write failing handler tests**

Test:
- valid V2 payload inserts run + steps and returns `{ id, runId, duplicate: false }`;
- replay returns the prior row / `{ duplicate: true }` without adding steps;
- malformed timestamp, negative duration, unsupported adapter, excess step count, oversized strings, and prohibited extra keys yield `400`;
- caller-provided `actor_user_id` is ignored/rejected;
- server validates that remote provenance belongs to a published version/namespace, otherwise degrades to local attribution or rejects according to the finalized policy.

**Step 2: Run test and confirm failure**

Run: `bun test tests/supabase-functions.test.ts`

Expected: FAIL because the handler is V1 run-summary-only.

**Step 3: Implement strict normalization**

- Define a single V2 normalizer in the handler (or shared server schema module), never pass the raw request body into `metadata`.
- Limit step records per run to a documented maximum (for example 500) and cap all string lengths.
- Derive `actor_user_id` and auth method exclusively from `AuthContext`.
- Use the unique actor/run constraint as the authoritative deduplication guard.
- Preserve existing V1 clients for one release window by normalizing V1 into a safe V2 run-only record, then add deprecation messaging/documentation.
- Record only safe operation metadata: telemetry schema version, terminal state, and record counts.

**Step 4: Verify passing tests**

Run: `bun test tests/supabase-functions.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add supabase/functions/track-run-telemetry/handler.ts supabase/functions/_shared/ops.ts supabase/config.toml tests/supabase-functions.test.ts src/remote/api.ts
git commit -m "feat: ingest runner observability telemetry idempotently"
```

### Task 7: Build owner and anonymous-community observability APIs

**Objective:** Serve useful aggregates without a path to peer re-identification.

**Files:**
- Create: `supabase/functions/workflow-observability/handler.ts`
- Create: `supabase/functions/workflow-observability/index.ts`
- Modify: `supabase/config.toml`
- Modify: `supabase/functions/README.md`
- Modify: `supabase/functions/workflow-run-insights/handler.ts`
- Modify: `tests/supabase-functions.test.ts`
- Modify: `src/remote/api.ts`
- Modify: `apps/remote-registry/src/lib/remoteApi.ts`
- Modify: `apps/remote-registry/src/types.ts`

**Step 1: Write failing authorization and suppression tests**

Add tests for:
- a non-owner receives `403` when requesting creator observability for another namespace;
- owner sees their own aggregate even with one run;
- community fields are `{ suppressed: true, minimumCohort: 5 }` for 1–4 distinct users;
- with five distinct users, responses contain aggregate metrics and dimensions only;
- response JSON does not contain `actor_user_id`, `auth_method`, `run_id`, `created_at`, `failure_reason`, source name/path, or a peer-run array;
- date filters use an allow-listed range (7/30/90 days) and cannot create arbitrary costly scans.

**Step 2: Run tests to verify failure**

Run: `bun test tests/supabase-functions.test.ts`

Expected: FAIL because no observability endpoint or k-anonymity logic exists.

**Step 3: Implement API query behavior**

- Create `GET workflow-observability?slug=<slug>&version=<label>&window=30d` protected by `workflow:read` and namespace ownership validation.
- Query daily rollups for dashboard ranges; query raw rows only for the authenticated user’s own detailed “My runs” view and only within the 90-day retention period.
- Return server-calculated p50/p95, average, success rates, terminal-state totals, retry totals, runtime/model breakdowns, and step hotspots.
- Apply `HAVING count(distinct actor_user_id) >= 5` at the source query / rollup generation. Do not rely on frontend suppression.
- Update `workflow-run-insights` to retain its current own-runs summary behavior and add a clearly separated `owner` vs `community` response contract rather than silently broadening it.

**Step 4: Verify passing tests**

Run: `bun test tests/supabase-functions.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add supabase/functions/workflow-observability supabase/functions/workflow-run-insights/handler.ts supabase/config.toml supabase/functions/README.md tests/supabase-functions.test.ts src/remote/api.ts apps/remote-registry/src/lib/remoteApi.ts apps/remote-registry/src/types.ts
git commit -m "feat: expose private and anonymous workflow observability"
```

### Task 8: Add a creator observability dashboard with clear anonymity UX

**Objective:** Let owners identify regressions and runtime differences without presenting peer activity as identifiable data.

**Files:**
- Create: `apps/remote-registry/src/pages/WorkflowObservabilityPage.tsx`
- Modify: `apps/remote-registry/src/pages/DashboardPage.tsx`
- Modify: `apps/remote-registry/src/main.tsx` (routes)
- Modify: `apps/remote-registry/src/lib/remoteApi.ts`
- Modify: `apps/remote-registry/src/types.ts`
- Modify: `apps/remote-registry/src/index.css`
- Create: `apps/remote-registry/src/pages/WorkflowObservabilityPage.test.tsx` (or project-standard equivalent)
- Modify: `tests/remote-registry-app.test.ts`

**Step 1: Write failing UI tests**

Assert:
- the dashboard links each owned workflow to its observability view;
- the observability page renders overall run health, duration percentiles, runtime/model breakdown, and slowest steps;
- a below-threshold community response renders “Not enough anonymous usage yet” and never displays a numeric peer count/rate;
- the page does not render response fields disallowed by the API contract;
- loading, error, empty, and no-auth states are accessible.

**Step 2: Run tests to verify failure**

Run: `bun run remote-registry:test`

Expected: FAIL because the page and routes do not exist.

**Step 3: Implement the smallest useful visual hierarchy**

- Add an “Observability” action to owned workflow cards on `DashboardPage`.
- Build a workflow/version selector and a 7/30/90-day window control.
- Use cards for owner health (runs/success/p50/p95/effectiveness), a runtime/model comparison table, and a step-hotspot table ordered by p95 duration.
- Add an “Anonymous community benchmark” panel with an info tooltip explaining: “Aggregated across at least 5 distinct authenticated users. No individual activity is shown.”
- For suppressed data, show a neutral explanatory empty state—not a zero-valued chart.
- Keep “My runs” distinct from creator/community observability; do not combine tables in a way that could imply a peer’s identity.

**Step 4: Verify passing UI tests and build**

Run:

```bash
bun run remote-registry:test
bun run remote-registry:build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/remote-registry/src/pages/WorkflowObservabilityPage.tsx apps/remote-registry/src/pages/WorkflowObservabilityPage.test.tsx apps/remote-registry/src/pages/DashboardPage.tsx apps/remote-registry/src/main.tsx apps/remote-registry/src/lib/remoteApi.ts apps/remote-registry/src/types.ts apps/remote-registry/src/index.css tests/remote-registry-app.test.ts
git commit -m "feat: add privacy-safe workflow observability dashboard"
```

### Task 9: Document, test privacy regressions, and release safely

**Objective:** Make data collection understandable and prevent future changes from weakening anonymity guarantees.

**Files:**
- Create: `doc/guide/observability.md`
- Modify: `doc/index.md`
- Modify: `doc/guide/getting-started.md`
- Modify: `doc/guide/architecture.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `supabase/README.md`
- Create: `tests/observability-privacy.test.ts`

**Step 1: Write regression tests**

Create a response-schema/privacy test that recursively verifies creator/community JSON does not expose prohibited field names or row-level peer records. Add test cases for suppression, ownership, and schema-version compatibility.

**Step 2: Run tests to verify failure**

Run: `bun test tests/observability-privacy.test.ts`

Expected: FAIL until the contract assertions are implemented.

**Step 3: Write user-facing documentation**

Document:
- data collected and data never collected;
- default, opt-out/opt-in decision and exact configuration command/environment variable;
- retention and deletion behavior;
- attribution behavior for pulled vs local/modified workflows;
- meaning and limitations of requested model, success/effectiveness, averages, p50, p95, and anonymous benchmarks;
- `k=5` suppression behavior;
- operational deployment order: migrate DB, deploy ingestion, release CLI, then deploy observability API/UI.

**Step 4: Run full verification**

Run:

```bash
bun run lint
bun test
bun run build
bun run remote-registry:test
bun run remote-registry:build
bun run docs:build
bun run supabase:db:lint
bun run supabase:test
```

Expected: every command exits `0`.

**Step 5: Manual acceptance verification**

1. Publish a test workflow and pull it using five separate test accounts.
2. Run it with at least two adapters/models and one controlled failure/retry.
3. Confirm the owner sees health, timing, adapter/model, and version segments.
4. Confirm a sub-threshold segment is suppressed.
5. Confirm the owner cannot retrieve any peer identity, raw run, source path, prompt, input/output, or log through browser responses or direct Edge Function calls.
6. Set `WFM_TELEMETRY=off`, run again, and confirm no telemetry request is sent.
7. Confirm legacy V1 CLI telemetry continues to be accepted for the announced transition period.

**Step 6: Commit**

```bash
git add doc README.md CHANGELOG.md supabase/README.md tests/observability-privacy.test.ts
git commit -m "docs: document runner observability and privacy controls"
```

---

## Deployment order and rollback

1. Deploy migrations, retention job, and ingestion handler with V1 compatibility still enabled.
2. Deploy aggregate API; test ownership, suppression, and query performance against production-like data.
3. Release the CLI V2 emitter. Monitor ingestion validation error rate, duplicate rate, and payload-size rejects without logging payload contents.
4. Deploy the remote registry UI after real V2 data is available.
5. After one supported CLI release cycle, remove V1 ingestion compatibility only after checking client-version telemetry.

**Rollback:** Disable V2 telemetry emission remotely/configurably, keep workflow execution unaffected, and hide the observability route. Do not drop raw tables or loosen RLS as a rollback mechanism.

## Acceptance criteria

- A creator can identify workflow/version health, slow steps, requested model, and agent/adapter usage.
- The same workflow run by multiple authenticated users produces a community comparison only when at least five distinct users contribute.
- No API/UI response reveals another user’s identity, runs, raw inputs/outputs, prompts, logs, filesystem paths, host details, or token data.
- Telemetry cannot break or alter workflow execution; it is bounded, idempotent, and best-effort.
- Local/modified workflows remain useful in a user’s own telemetry but are not attributed to a remote creator/version.
- All repository-required lint, test, build, remote registry, docs, and Supabase validations pass.
