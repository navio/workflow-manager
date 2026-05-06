create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_username_length check (username is null or char_length(username) between 3 and 32),
  constraint profiles_username_format check (
    username is null or username ~ '^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])?$'
  )
);

create table public.workflow_namespaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null,
  title text not null,
  description text,
  visibility text not null default 'private',
  latest_version_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint workflow_namespaces_visibility check (visibility in ('public', 'private')),
  constraint workflow_namespaces_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$'),
  constraint workflow_namespaces_owner_slug_key unique (owner_user_id, slug)
);

create table public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  namespace_id uuid not null references public.workflow_namespaces (id) on delete cascade,
  version_label text not null,
  source_format text not null,
  raw_source text not null,
  definition_json jsonb not null,
  changelog text,
  published_state text not null default 'draft',
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  constraint workflow_versions_source_format check (source_format in ('markdown', 'json')),
  constraint workflow_versions_published_state check (published_state in ('draft', 'published')),
  constraint workflow_versions_namespace_label_key unique (namespace_id, version_label)
);

alter table public.workflow_namespaces
  add constraint workflow_namespaces_latest_version_id_fkey
  foreign key (latest_version_id) references public.workflow_versions (id) on delete set null;

create table public.workflow_tags (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  constraint workflow_tags_name_format check (name ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$')
);

create table public.workflow_version_tags (
  workflow_version_id uuid not null references public.workflow_versions (id) on delete cascade,
  tag_id bigint not null references public.workflow_tags (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workflow_version_id, tag_id)
);

create table public.cli_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  scopes text[] not null default array['workflow:read', 'workflow:write']::text[],
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint cli_tokens_name_length check (char_length(name) between 1 and 120)
);

create table public.workflow_download_events (
  id uuid primary key default gen_random_uuid(),
  namespace_id uuid not null references public.workflow_namespaces (id) on delete cascade,
  version_id uuid not null references public.workflow_versions (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  channel text not null default 'cli',
  client_version text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint workflow_download_events_channel check (channel in ('cli', 'web', 'api'))
);

create table public.workflow_daily_stats (
  namespace_id uuid not null references public.workflow_namespaces (id) on delete cascade,
  stat_date date not null,
  downloads integer not null default 0,
  unique_downloaders integer not null default 0,
  last_downloaded_at timestamptz,
  primary key (namespace_id, stat_date),
  constraint workflow_daily_stats_downloads_nonnegative check (downloads >= 0),
  constraint workflow_daily_stats_unique_downloaders_nonnegative check (unique_downloaders >= 0)
);

create index workflow_namespaces_visibility_idx on public.workflow_namespaces (visibility);
create index workflow_namespaces_created_at_idx on public.workflow_namespaces (created_at desc);
create index workflow_versions_namespace_created_at_idx on public.workflow_versions (namespace_id, created_at desc);
create index workflow_versions_published_state_idx on public.workflow_versions (published_state);
create index cli_tokens_user_created_at_idx on public.cli_tokens (user_id, created_at desc);
create index workflow_download_events_namespace_created_at_idx
  on public.workflow_download_events (namespace_id, created_at desc);
create index workflow_download_events_version_created_at_idx
  on public.workflow_download_events (version_id, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute procedure public.set_updated_at();

create trigger set_workflow_namespaces_updated_at
before update on public.workflow_namespaces
for each row
execute procedure public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.workflow_namespaces enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_tags enable row level security;
alter table public.workflow_version_tags enable row level security;
alter table public.cli_tokens enable row level security;
alter table public.workflow_download_events enable row level security;
alter table public.workflow_daily_stats enable row level security;

create policy "profiles are publicly readable"
on public.profiles
for select
using (true);

create policy "users can insert their own profile"
on public.profiles
for insert
with check ((select auth.uid()) = id);

create policy "users can update their own profile"
on public.profiles
for update
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "workflow namespaces are readable to owners or public"
on public.workflow_namespaces
for select
using (visibility = 'public' or (select auth.uid()) = owner_user_id);

create policy "owners can insert workflow namespaces"
on public.workflow_namespaces
for insert
with check ((select auth.uid()) = owner_user_id);

create policy "owners can update workflow namespaces"
on public.workflow_namespaces
for update
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

create policy "owners can delete workflow namespaces"
on public.workflow_namespaces
for delete
using ((select auth.uid()) = owner_user_id);

create policy "workflow versions are readable to owners or public published viewers"
on public.workflow_versions
for select
using (
  exists (
    select 1
    from public.workflow_namespaces wn
    where wn.id = workflow_versions.namespace_id
      and (
        ((wn.visibility = 'public') and (workflow_versions.published_state = 'published'))
        or ((select auth.uid()) = wn.owner_user_id)
      )
  )
);

create policy "owners can insert workflow versions"
on public.workflow_versions
for insert
with check (
  ((select auth.uid()) = created_by_user_id)
  and exists (
    select 1
    from public.workflow_namespaces wn
    where wn.id = workflow_versions.namespace_id
      and wn.owner_user_id = (select auth.uid())
  )
);

create policy "workflow tags are publicly readable"
on public.workflow_tags
for select
using (true);

create policy "workflow version tags are readable with readable workflow versions"
on public.workflow_version_tags
for select
using (
  exists (
    select 1
    from public.workflow_versions wv
    join public.workflow_namespaces wn on wn.id = wv.namespace_id
    where wv.id = workflow_version_tags.workflow_version_id
      and (
        ((wn.visibility = 'public') and (wv.published_state = 'published'))
        or ((select auth.uid()) = wn.owner_user_id)
      )
  )
);

create policy "owners can view their cli tokens"
on public.cli_tokens
for select
using ((select auth.uid()) = user_id);

create policy "owners can insert their cli tokens"
on public.cli_tokens
for insert
with check ((select auth.uid()) = user_id);

create policy "owners can update their cli tokens"
on public.cli_tokens
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "owners can delete their cli tokens"
on public.cli_tokens
for delete
using ((select auth.uid()) = user_id);

create policy "owners can view download events for their workflows"
on public.workflow_download_events
for select
using (
  exists (
    select 1
    from public.workflow_namespaces wn
    where wn.id = workflow_download_events.namespace_id
      and wn.owner_user_id = (select auth.uid())
  )
);

create policy "owners can view daily stats for their workflows"
on public.workflow_daily_stats
for select
using (
  exists (
    select 1
    from public.workflow_namespaces wn
    where wn.id = workflow_daily_stats.namespace_id
      and wn.owner_user_id = (select auth.uid())
  )
);
