create table public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_key text not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.registry_operation_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  status text not null,
  actor_key text,
  actor_user_id uuid references auth.users (id) on delete set null,
  resource_type text,
  resource_id text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint registry_operation_logs_status check (status in ('success', 'error', 'rate_limited'))
);

create index rate_limit_events_action_actor_created_at_idx
  on public.rate_limit_events (action, actor_key, created_at desc);

create index registry_operation_logs_action_created_at_idx
  on public.registry_operation_logs (action, created_at desc);

create index registry_operation_logs_actor_user_id_idx
  on public.registry_operation_logs (actor_user_id, created_at desc);

create function public.refresh_workflow_daily_stat(p_namespace_id uuid, p_stat_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workflow_daily_stats (namespace_id, stat_date, downloads, unique_downloaders, last_downloaded_at)
  select
    p_namespace_id,
    p_stat_date,
    count(*)::integer,
    count(distinct actor_user_id)::integer,
    max(created_at)
  from public.workflow_download_events
  where namespace_id = p_namespace_id
    and created_at >= p_stat_date::timestamp
    and created_at < (p_stat_date + interval '1 day')
  group by namespace_id
  on conflict (namespace_id, stat_date)
  do update set
    downloads = excluded.downloads,
    unique_downloaders = excluded.unique_downloaders,
    last_downloaded_at = excluded.last_downloaded_at;

  if not found then
    insert into public.workflow_daily_stats (namespace_id, stat_date, downloads, unique_downloaders, last_downloaded_at)
    values (p_namespace_id, p_stat_date, 0, 0, null)
    on conflict (namespace_id, stat_date)
    do update set
      downloads = excluded.downloads,
      unique_downloaders = excluded.unique_downloaders,
      last_downloaded_at = excluded.last_downloaded_at;
  end if;
end;
$$;

create function public.refresh_workflow_daily_stats(
  p_since date default (current_date - 30),
  p_namespace_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  stat_record record;
  processed_count integer := 0;
begin
  for stat_record in
    select distinct namespace_id, (created_at at time zone 'utc')::date as stat_date
    from public.workflow_download_events
    where created_at >= p_since::timestamp
      and (p_namespace_id is null or namespace_id = p_namespace_id)
  loop
    perform public.refresh_workflow_daily_stat(stat_record.namespace_id, stat_record.stat_date);
    processed_count := processed_count + 1;
  end loop;

  return processed_count;
end;
$$;

alter table public.rate_limit_events enable row level security;
alter table public.registry_operation_logs enable row level security;

create policy "owners can view their registry operation logs"
on public.registry_operation_logs
for select
using ((select auth.uid()) = actor_user_id);
