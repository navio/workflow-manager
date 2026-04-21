create index rate_limit_events_actor_user_id_idx
  on public.rate_limit_events (actor_user_id, created_at desc);

create policy "rate limit events are not directly accessible"
on public.rate_limit_events
for all
using (false)
with check (false);
