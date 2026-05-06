create table public.workflow_run_telemetry (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  auth_method text not null,
  workflow_key text not null,
  workflow_title text,
  run_id text not null,
  terminal_state text not null,
  total_steps integer not null default 0,
  succeeded_steps integer not null default 0,
  failed_steps integer not null default 0,
  waiting_steps integer not null default 0,
  cancelled_steps integer not null default 0,
  retried_steps integer not null default 0,
  event_count integer not null default 0,
  duration_ms integer not null default 0,
  effectiveness_score numeric(5,2) not null default 0,
  output_keys text[] not null default array[]::text[],
  source_name text,
  source_format text,
  cli_version text,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint workflow_run_telemetry_auth_method_check check (auth_method in ('cli_token', 'jwt')),
  constraint workflow_run_telemetry_terminal_state_check check (
    terminal_state in ('succeeded', 'failed', 'waiting_for_approval', 'cancelled')
  ),
  constraint workflow_run_telemetry_total_steps_nonnegative check (total_steps >= 0),
  constraint workflow_run_telemetry_succeeded_steps_nonnegative check (succeeded_steps >= 0),
  constraint workflow_run_telemetry_failed_steps_nonnegative check (failed_steps >= 0),
  constraint workflow_run_telemetry_waiting_steps_nonnegative check (waiting_steps >= 0),
  constraint workflow_run_telemetry_cancelled_steps_nonnegative check (cancelled_steps >= 0),
  constraint workflow_run_telemetry_retried_steps_nonnegative check (retried_steps >= 0),
  constraint workflow_run_telemetry_event_count_nonnegative check (event_count >= 0),
  constraint workflow_run_telemetry_duration_nonnegative check (duration_ms >= 0),
  constraint workflow_run_telemetry_effectiveness_range check (effectiveness_score >= 0 and effectiveness_score <= 100)
);

create index workflow_run_telemetry_actor_created_at_idx
  on public.workflow_run_telemetry (actor_user_id, created_at desc);

create index workflow_run_telemetry_workflow_key_idx
  on public.workflow_run_telemetry (workflow_key, created_at desc);

alter table public.workflow_run_telemetry enable row level security;

create policy "users can view their own workflow run telemetry"
on public.workflow_run_telemetry
for select
using ((select auth.uid()) = actor_user_id);
