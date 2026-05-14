-- Pilot seed: 1 org, 1 team. Users join via magic-link signup; the
-- handle_new_user() trigger assigns them to this org automatically.
-- After signup, run admin task to add users to the pilot team.

insert into organizations (id, name, timezone)
values ('00000000-0000-0000-0000-000000000001', 'Pilot Org', 'America/New_York')
on conflict (id) do nothing;

insert into teams (id, org_id, name)
values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Leadership Team')
on conflict (id) do nothing;

-- Sample scorecard metrics (no owner until users join)
insert into scorecard_metrics (id, team_id, name, unit, goal, direction, sort_order) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010', 'Weekly Revenue',     'currency', 50000, 'gte', 1),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', 'New Customers',      'number',       5, 'gte', 2),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000010', 'NPS',                'number',      50, 'gte', 3),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000010', 'Support Tickets',    'number',      20, 'lte', 4),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000010', 'Cash on Hand (days)','number',      90, 'gte', 5)
on conflict (id) do nothing;

-- Sample rocks
insert into rocks (team_id, title, quarter, due_date, status, description) values
  ('00000000-0000-0000-0000-000000000010', 'Ship EOS v1 to pilot team', '2026-Q2', '2026-06-30', 'on_track', 'Replace ninety.io for our leadership team'),
  ('00000000-0000-0000-0000-000000000010', 'Document core sales process', '2026-Q2', '2026-06-15', 'on_track', null);
