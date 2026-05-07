-- tighten handle format and reserve route-like usernames
alter table public.profiles
  drop constraint if exists profiles_username_format,
  add constraint profiles_username_format check (
    username is null
    or (
      username = lower(username)
      and username ~ '^[a-z0-9][a-z0-9-]{1,29}$'
    )
  );

alter table public.profiles
  drop constraint if exists profiles_username_reserved,
  add constraint profiles_username_reserved check (
    username is null
    or username not in (
      'admin', 'api', 'org', 'team', 'enterprise', 'support', 'help',
      'billing', 'security', 'abuse', 'legal', 'privacy', 'status',
      'auth', 'callback', 'confirm', 'onboard', 'dashboard', 'settings'
    )
  );

-- forward-compat for domain-aware onboarding
alter table public.profiles
  add column if not exists email_domain text;

update public.profiles p
set email_domain = case
  when u.email like '%@%' then lower(split_part(u.email, '@', 2))
  else null
end
from auth.users u
where u.id = p.id
  and p.email_domain is distinct from case
    when u.email like '%@%' then lower(split_part(u.email, '@', 2))
    else null
  end;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, email_domain)
  values (
    new.id,
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'avatar_url',
    case
      when new.email like '%@%' then lower(split_part(new.email, '@', 2))
      else null
    end
  );
  return new;
end;
$$;
