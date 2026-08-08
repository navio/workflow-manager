-- Rollup + retention functions for runner observability. These are plain SQL functions
-- meant to be invoked by an external scheduler (e.g. a daily Supabase/GitHub Actions
-- cron calling `select public.rollup_workflow_observability_day(...)` then
-- `select public.purge_expired_runner_observability_raw_rows()`); this repo does not
-- assume pg_cron is enabled.

create or replace function public.rollup_workflow_observability_day(p_stat_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_processed integer := 0;
begin
  -- Overall per (namespace, version) rollup: no adapter/model/step breakdown.
  insert into public.workflow_observability_daily_rollups (
    namespace_id, version_id, stat_date, adapter, requested_model, step_key,
    total_count, succeeded_count, failed_count, waiting_count, cancelled_count,
    retried_count, distinct_actor_count, avg_duration_ms, p50_duration_ms, p95_duration_ms
  )
  select
    r.workflow_namespace_id,
    r.workflow_version_id,
    p_stat_date,
    '', '', '',
    count(*)::integer,
    count(*) filter (where r.terminal_state = 'succeeded')::integer,
    count(*) filter (where r.terminal_state = 'failed')::integer,
    count(*) filter (where r.terminal_state = 'waiting_for_approval')::integer,
    count(*) filter (where r.terminal_state = 'cancelled')::integer,
    coalesce(sum(r.retried_steps), 0)::integer,
    count(distinct r.actor_user_id)::integer,
    avg(r.duration_ms),
    percentile_cont(0.5) within group (order by r.duration_ms),
    percentile_cont(0.95) within group (order by r.duration_ms)
  from public.workflow_run_telemetry r
  where r.workflow_namespace_id is not null
    and r.workflow_version_id is not null
    and r.created_at >= p_stat_date::timestamp
    and r.created_at < (p_stat_date + interval '1 day')
  group by r.workflow_namespace_id, r.workflow_version_id
  on conflict (namespace_id, version_id, stat_date, adapter, requested_model, step_key)
  do update set
    total_count = excluded.total_count,
    succeeded_count = excluded.succeeded_count,
    failed_count = excluded.failed_count,
    waiting_count = excluded.waiting_count,
    cancelled_count = excluded.cancelled_count,
    retried_count = excluded.retried_count,
    distinct_actor_count = excluded.distinct_actor_count,
    avg_duration_ms = excluded.avg_duration_ms,
    p50_duration_ms = excluded.p50_duration_ms,
    p95_duration_ms = excluded.p95_duration_ms,
    updated_at = timezone('utc', now());
  get diagnostics v_processed = row_count;

  -- Runtime/model adoption breakdown, one row per (namespace, version, adapter, model).
  -- Aggregated over step *executions* (not whole runs): a run can mix adapters/models
  -- across its steps, so attributing a run-level count/duration to a single adapter
  -- would either double-count or be arbitrary. Sourcing straight from
  -- workflow_step_telemetry (like the step-hotspot rollup below) keeps this correct
  -- without a run-to-step join that would fan out and inflate run-level sums.
  insert into public.workflow_observability_daily_rollups (
    namespace_id, version_id, stat_date, adapter, requested_model, step_key,
    total_count, succeeded_count, failed_count, waiting_count, cancelled_count,
    retried_count, distinct_actor_count, avg_duration_ms, p50_duration_ms, p95_duration_ms
  )
  select
    s.workflow_namespace_id,
    s.workflow_version_id,
    p_stat_date,
    s.adapter,
    coalesce(s.requested_model, ''),
    '',
    count(*)::integer,
    count(*) filter (where s.terminal_status = 'succeeded')::integer,
    count(*) filter (where s.terminal_status = 'failed')::integer,
    count(*) filter (where s.terminal_status = 'waiting_for_approval')::integer,
    count(*) filter (where s.terminal_status = 'cancelled')::integer,
    count(*) filter (where s.attempt > 1)::integer,
    count(distinct s.actor_user_id)::integer,
    avg(s.execution_duration_ms),
    percentile_cont(0.5) within group (order by s.execution_duration_ms),
    percentile_cont(0.95) within group (order by s.execution_duration_ms)
  from public.workflow_step_telemetry s
  where s.workflow_namespace_id is not null
    and s.workflow_version_id is not null
    and s.created_at >= p_stat_date::timestamp
    and s.created_at < (p_stat_date + interval '1 day')
  group by s.workflow_namespace_id, s.workflow_version_id, s.adapter, coalesce(s.requested_model, '')
  on conflict (namespace_id, version_id, stat_date, adapter, requested_model, step_key)
  do update set
    total_count = excluded.total_count,
    succeeded_count = excluded.succeeded_count,
    failed_count = excluded.failed_count,
    waiting_count = excluded.waiting_count,
    cancelled_count = excluded.cancelled_count,
    retried_count = excluded.retried_count,
    distinct_actor_count = excluded.distinct_actor_count,
    avg_duration_ms = excluded.avg_duration_ms,
    p50_duration_ms = excluded.p50_duration_ms,
    p95_duration_ms = excluded.p95_duration_ms,
    updated_at = timezone('utc', now());

  -- Step hotspot rollup, one row per (namespace, version, step_key, adapter, model).
  insert into public.workflow_observability_daily_rollups (
    namespace_id, version_id, stat_date, adapter, requested_model, step_key,
    total_count, succeeded_count, failed_count, waiting_count, cancelled_count,
    retried_count, distinct_actor_count, avg_duration_ms, p50_duration_ms, p95_duration_ms
  )
  select
    s.workflow_namespace_id,
    s.workflow_version_id,
    p_stat_date,
    s.adapter,
    coalesce(s.requested_model, ''),
    s.step_key,
    count(*)::integer,
    count(*) filter (where s.terminal_status = 'succeeded')::integer,
    count(*) filter (where s.terminal_status = 'failed')::integer,
    count(*) filter (where s.terminal_status = 'waiting_for_approval')::integer,
    count(*) filter (where s.terminal_status = 'cancelled')::integer,
    count(*) filter (where s.attempt > 1)::integer,
    count(distinct s.actor_user_id)::integer,
    avg(s.execution_duration_ms),
    percentile_cont(0.5) within group (order by s.execution_duration_ms),
    percentile_cont(0.95) within group (order by s.execution_duration_ms)
  from public.workflow_step_telemetry s
  where s.workflow_namespace_id is not null
    and s.workflow_version_id is not null
    and s.created_at >= p_stat_date::timestamp
    and s.created_at < (p_stat_date + interval '1 day')
  group by s.workflow_namespace_id, s.workflow_version_id, s.adapter, coalesce(s.requested_model, ''), s.step_key
  on conflict (namespace_id, version_id, stat_date, adapter, requested_model, step_key)
  do update set
    total_count = excluded.total_count,
    succeeded_count = excluded.succeeded_count,
    failed_count = excluded.failed_count,
    waiting_count = excluded.waiting_count,
    cancelled_count = excluded.cancelled_count,
    retried_count = excluded.retried_count,
    distinct_actor_count = excluded.distinct_actor_count,
    avg_duration_ms = excluded.avg_duration_ms,
    p50_duration_ms = excluded.p50_duration_ms,
    p95_duration_ms = excluded.p95_duration_ms,
    updated_at = timezone('utc', now());

  return v_processed;
end;
$$;

create or replace function public.rollup_workflow_observability(
  p_since date default (current_date - 1),
  p_until date default current_date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_processed integer := 0;
begin
  v_date := p_since;
  while v_date <= p_until loop
    perform public.rollup_workflow_observability_day(v_date);
    v_processed := v_processed + 1;
    v_date := v_date + 1;
  end loop;

  return v_processed;
end;
$$;

-- Deletes raw run/step telemetry older than the retention window. Intended to run after
-- rollups have processed the same window (a daily rollup job runs before this), so
-- deleting raw rows never loses data that hasn't yet been reflected in an aggregate.
-- Step rows are deleted explicitly (in addition to relying on the run row's cascading
-- delete) so the predicate is self-documenting from this function alone.
create or replace function public.purge_expired_runner_observability_raw_rows(p_retention_days integer default 90)
returns table (deleted_runs integer, deleted_steps integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := timezone('utc', now()) - (p_retention_days || ' days')::interval;
  v_deleted_steps integer;
  v_deleted_runs integer;
begin
  delete from public.workflow_step_telemetry
  where created_at < v_cutoff;
  get diagnostics v_deleted_steps = row_count;

  delete from public.workflow_run_telemetry
  where created_at < v_cutoff;
  get diagnostics v_deleted_runs = row_count;

  return query select v_deleted_runs, v_deleted_steps;
end;
$$;
