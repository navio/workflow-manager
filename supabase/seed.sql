insert into public.workflow_tags (name)
values
  ('automation'),
  ('coding'),
  ('documentation'),
  ('testing')
on conflict (name) do nothing;
