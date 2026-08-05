-- V2 runner observability: normalized run fields, per-attempt step telemetry, and
-- daily rollups for owner/community aggregate queries. See doc/guide/observability.md
-- for the full product/privacy contract.

alter table public.workflow_run_telemetry
  add column schema_version smallint not null default 1,
  add column workflow_fingerprint text,
  add column workflow_origin text not null default 'local',
  add column workflow_namespace_id uuid references public.workflow_namespaces (id) on delete set null,
  add column workflow_version_id uuid references public.workflow_versions (id) on delete set null,
  add column workflow_version_label text,
  add column started_at timestamptz,
  add column ended_at timestamptz,
  add column runner_platform text,
  add column failure_category text;

alter table public.workflow_run_telemetry
  add constraint workflow_run_telemetry_schema_version_check check (schema_version in (1, 2)),
  add constraint workflow_run_telemetry_workflow_origin_check check (workflow_origin in ('remote', 'local')),
  add constraint workflow_run_telemetry_runner_platform_check check (
    runner_platform is null or runner_platform in ('darwin', 'linux', 'win32', 'unknown')
  ),
  add constraint workflow_run_telemetry_failure_category_check check (
    failure_category is null
    or failure_category in ('validation', 'preflight', 'adapter', 'execution', 'approval', 'cancelled', 'unknown')
  );

-- Idempotency guard: a retried/duplicate submission of the same authenticated user's run
-- (the CLI sends Idempotency-Key: <runId>) must never create a second row.
create unique index workflow_run_telemetry_actor_run_id_uidx
  on public.workflow_run_telemetry (actor_user_id, run_id);

create index workflow_run_telemetry_namespace_version_created_at_idx
  on public.workflow_run_telemetry (workflow_namespace_id, workflow_version_id, created_at desc);

-- One row per executed step attempt. Deliberately has no client-select RLS policy: it is
-- read/written exclusively through service-role Edge Functions, which enforce their own
-- ownership/aggregation authorization (see workflow-observability and
-- track-run-telemetry). Enabling RLS with zero policies denies all direct
-- anon/authenticated access as defense-in-depth; it does not grant any.
create table public.workflow_step_telemetry (
  id uuid primary key default gen_random_uuid(),
  run_telemetry_id uuid not null references public.workflow_run_telemetry (id) on delete cascade,
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  workflow_namespace_id uuid references public.workflow_namespaces (id) on delete set null,
  workflow_version_id uuid references public.workflow_versions (id) on delete set null,
  step_key text not null,
  step_kind text not null,
  attempt integer not null default 1,
  terminal_status text not null,
  adapter text not null,
  requested_model text,
  started_at timestamptz,
  ended_at timestamptz,
  execution_duration_ms integer,
  queue_duration_ms integer,
  execution_status text,
  qa_action text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint workflow_step_telemetry_step_key_length check (char_length(step_key) between 1 and 200),
  constraint workflow_step_telemetry_step_kind_check check (step_kind in ('task', 'approval', 'system')),
  constraint workflow_step_telemetry_attempt_positive check (attempt >= 1),
  constraint workflow_step_telemetry_terminal_status_check check (
    terminal_status in ('succeeded', 'failed', 'waiting_for_approval', 'cancelled')
  ),
  constraint workflow_step_telemetry_adapter_length check (char_length(adapter) between 1 and 40),
  constraint workflow_step_telemetry_requested_model_length check (
    requested_model is null or char_length(requested_model) <= 100
  ),
  constraint workflow_step_telemetry_duration_nonnegative check (
    execution_duration_ms is null or execution_duration_ms >= 0
  ),
  constraint workflow_step_telemetry_queue_duration_nonnegative check (
    queue_duration_ms is null or queue_duration_ms >= 0
  ),
  constraint workflow_step_telemetry_execution_status_check check (
    execution_status is null or execution_status in ('SUCCESS', 'QA_REJECTED', 'YIELD_EXTERNAL', 'FAILED')
  ),
  constraint workflow_step_telemetry_qa_action_check check (
    qa_action is null or qa_action in ('PROCEED', 'RETRY_CURRENT', 'ROLLBACK_PREVIOUS', 'RESTART_ALL')
  )
);

create index workflow_step_telemetry_run_telemetry_id_idx
  on public.workflow_step_telemetry (run_telemetry_id);

create index workflow_step_telemetry_actor_created_at_idx
  on public.workflow_step_telemetry (actor_user_id, created_at desc);

create index workflow_step_telemetry_namespace_version_created_at_idx
  on public.workflow_step_telemetry (workflow_namespace_id, workflow_version_id, created_at desc);

create index workflow_step_telemetry_step_agg_idx
  on public.workflow_step_telemetry (workflow_namespace_id, workflow_version_id, step_key, adapter, requested_model);

alter table public.workflow_step_telemetry enable row level security;

-- Daily aggregate rollups. Dimension columns use '' (not null) to mean "aggregated across
-- all values of that dimension" so a single unique index can serve as the upsert target
-- for the overall/runtime/step aggregation grains without NULL-distinctness surprises.
-- Only rows for a namespace_id/version_id (i.e. remote-attributed runs) are ever rolled
-- up here; local/unattributed runs are never included in cross-user aggregates. No actor
-- identifiers are stored — only distinct_actor_count, used solely for k-anonymity
-- suppression by the API layer.
create table public.workflow_observability_daily_rollups (
  id uuid primary key default gen_random_uuid(),
  namespace_id uuid not null references public.workflow_namespaces (id) on delete cascade,
  version_id uuid not null references public.workflow_versions (id) on delete cascade,
  stat_date date not null,
  adapter text not null default '',
  requested_model text not null default '',
  step_key text not null default '',
  total_count integer not null default 0,
  succeeded_count integer not null default 0,
  failed_count integer not null default 0,
  waiting_count integer not null default 0,
  cancelled_count integer not null default 0,
  retried_count integer not null default 0,
  distinct_actor_count integer not null default 0,
  avg_duration_ms numeric,
  p50_duration_ms numeric,
  p95_duration_ms numeric,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint workflow_observability_daily_rollups_counts_nonnegative check (
    total_count >= 0
    and succeeded_count >= 0
    and failed_count >= 0
    and waiting_count >= 0
    and cancelled_count >= 0
    and retried_count >= 0
    and distinct_actor_count >= 0
  ),
  constraint workflow_observability_daily_rollups_dims_key unique (
    namespace_id, version_id, stat_date, adapter, requested_model, step_key
  )
);

create index workflow_observability_daily_rollups_namespace_version_date_idx
  on public.workflow_observability_daily_rollups (namespace_id, version_id, stat_date desc);

alter table public.workflow_observability_daily_rollups enable row level security;

-- Rollups are aggregate-only (no actor identity) but are still served exclusively through
-- the workflow-observability Edge Function so ownership/k-anonymity policy stays in one
-- place; no client-select policy is added here either.
