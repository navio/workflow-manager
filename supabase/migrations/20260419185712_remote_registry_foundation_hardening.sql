alter function public.set_updated_at() set search_path = '';

create index workflow_namespaces_latest_version_id_idx
  on public.workflow_namespaces (latest_version_id);

create index workflow_versions_created_by_user_id_idx
  on public.workflow_versions (created_by_user_id);

create index workflow_version_tags_tag_id_idx
  on public.workflow_version_tags (tag_id);

create index workflow_download_events_actor_user_id_idx
  on public.workflow_download_events (actor_user_id);
