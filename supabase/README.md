# Supabase Foundation

This directory contains the local and remote Supabase foundation for the remote registry project.

## Local development

Start the local stack:

```bash
bun run supabase:start
```

Reset the local database and apply migrations/seeds:

```bash
bun run supabase:db:reset
```

Show local service status:

```bash
bun run supabase:status
```

Stop the local stack:

```bash
bun run supabase:stop
```

Lint the local database schema after reset:

```bash
bun run supabase:db:lint
```

Run the focused Supabase handler and ops tests:

```bash
bun run supabase:test
```

## Current remote project

- project name: `workflow-manager-remote-registry`
- project ref: `whairnylpdvxxgbygbzu`
- region: `us-east-1`
- project url: `https://whairnylpdvxxgbygbzu.supabase.co`

## Deployed Edge Functions

- `create-cli-token` (custom token/JWT auth)
- `auth-whoami` (custom token/JWT auth)
- `list-cli-tokens` (custom token/JWT auth)
- `manage-workflow` (custom token/JWT auth)
- `refresh-workflow-stats` (custom token/JWT auth)
- `revoke-cli-token` (custom token/JWT auth)
- `publish-workflow` (custom token/JWT auth)
- `pull-workflow` (public + custom token/JWT auth)
- `search-workflows` (public + custom token/JWT auth)
- `workflow-analytics` (custom token/JWT auth)
- `track-run-telemetry` (custom token/JWT auth)
- `workflow-run-insights` (custom token/JWT auth)

Redeploy all current functions:

```bash
bun run supabase:functions:deploy
```

## GitHub automation

- PR validation for `supabase/**` lives in `.github/workflows/supabase-validate.yml`
- production release on merge to `main` lives in `.github/workflows/supabase-release.yml`
- the release workflow links the remote project, applies pending migrations, and deploys all Edge Functions

Required GitHub repository secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_ID`

`supabase/config.toml` is still local-development-first, so the CI release path intentionally does not run `supabase config push` yet.

Manual local deploys are still available, but GitHub Actions is now the primary production release path.

## Milestone 1 scope

- project config in `supabase/config.toml`
- schema migrations in `supabase/migrations/`
- seed data in `supabase/seed.sql`
- Edge Functions in `supabase/functions/`

## Milestone 5 ops additions

- aggregation SQL functions for `workflow_daily_stats`
- `rate_limit_events` table for action throttling
- `registry_operation_logs` table for operational visibility
- `refresh-workflow-stats` function for owner-triggered analytics refresh

## CLI telemetry additions

- `workflow_run_telemetry` table for authenticated CLI run telemetry
- `track-run-telemetry` function for run success/failure/effectiveness events
- `workflow-run-insights` function for authenticated run summaries

## Runner observability (V2 telemetry)

- Telemetry payloads are versioned (`schemaVersion`); the CLI-side contract and allow-list
  serializer live in `src/remote/observability.ts` (see `RunTelemetryPayloadV2` /
  `serializeRunTelemetryPayloadV2`). Only scalars and the fixed step-record shape are ever
  transmitted — never raw inputs/outputs, prompts, logs, hostnames, paths, or tokens.
- Raw run/step rows stay owner-only (`actor_user_id` is server-only and never selected in a
  creator/community response). Cross-user aggregates are suppressed unless a segment contains
  at least 5 distinct authenticated users (`k = 5` anonymity threshold).
- Schema (`supabase/migrations/20260804120000_runner_observability.sql`):
  - `workflow_run_telemetry` gains `schema_version`, `workflow_fingerprint`,
    `workflow_origin`, `workflow_namespace_id`/`workflow_version_id`/`workflow_version_label`,
    `started_at`/`ended_at`, `runner_platform`, `failure_category`, plus a unique
    `(actor_user_id, run_id)` index used as the idempotency guard.
  - `workflow_step_telemetry`: one row per executed step attempt. No client-select RLS
    policy — accessed only through service-role Edge Functions.
  - `workflow_observability_daily_rollups`: daily aggregates (counts, distinct user count,
    average/p50/p95 duration) at three grains — overall, per adapter/model, and per step —
    keyed by `(namespace_id, version_id, stat_date, adapter, requested_model, step_key)`
    with `''` meaning "all" for an unset dimension. Only remote-attributed runs are rolled
    up; local/unattributed runs never enter cross-user aggregates.
- Rollup/retention functions (`supabase/migrations/20260804120100_runner_observability_retention.sql`):
  `rollup_workflow_observability_day(date)`, `rollup_workflow_observability(since, until)`,
  and `purge_expired_runner_observability_raw_rows(retention_days default 90)`. These are
  plain SQL functions intended to be invoked by an external daily scheduler; no pg_cron
  dependency is assumed.
- Full product/privacy contract: `doc/guide/observability.md`.
