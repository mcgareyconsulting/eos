-- EOS app: initial schema + RLS
-- Single org for MVP, but data model supports multi-org.

create extension if not exists "pgcrypto";

-- ============================================================
-- Core tenancy
-- ============================================================
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  full_name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  parent_team_id uuid references teams(id) on delete set null,
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('leader', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_idx on team_members(user_id);

-- ============================================================
-- Scorecard
-- ============================================================
create table scorecard_metrics (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  unit text not null default 'number' check (unit in ('number','currency','percent','yesno','time')),
  goal numeric,
  direction text not null default 'gte' check (direction in ('gte','lte','eq')),
  owner_id uuid references auth.users(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index scorecard_metrics_team_idx on scorecard_metrics(team_id);

create table scorecard_entries (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references scorecard_metrics(id) on delete cascade,
  week_start_date date not null,
  value numeric,
  note text,
  created_at timestamptz not null default now(),
  unique (metric_id, week_start_date)
);

create index scorecard_entries_metric_week_idx on scorecard_entries(metric_id, week_start_date desc);

-- ============================================================
-- Rocks (quarterly priorities)
-- ============================================================
create table rocks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  title text not null,
  owner_id uuid references auth.users(id) on delete set null,
  quarter text not null,                  -- e.g. "2026-Q2"
  due_date date,
  status text not null default 'on_track' check (status in ('on_track','off_track','done','cancelled')),
  description text,
  created_at timestamptz not null default now()
);

create index rocks_team_idx on rocks(team_id);

-- ============================================================
-- To-Dos
-- ============================================================
create table issues (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  title text not null,
  description text,
  owner_id uuid references auth.users(id) on delete set null,
  priority int not null default 3 check (priority between 1 and 5),
  votes int not null default 0,
  type text not null default 'short' check (type in ('short','long')),
  status text not null default 'open' check (status in ('open','solving','solved','dropped')),
  resolved_at timestamptz,
  resolution_todo_id uuid,                -- set after IDS solve creates the to-do
  created_at timestamptz not null default now()
);

create index issues_team_status_idx on issues(team_id, status);

create table todos (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  title text not null,
  owner_id uuid references auth.users(id) on delete set null,
  due_date date,
  completed_at timestamptz,
  visibility text not null default 'team' check (visibility in ('team','private')),
  source_issue_id uuid references issues(id) on delete set null,
  source_meeting_id uuid,                 -- FK added after meetings table created
  created_at timestamptz not null default now()
);

create index todos_team_idx on todos(team_id);
create index todos_owner_open_idx on todos(owner_id) where completed_at is null;

alter table issues
  add constraint issues_resolution_todo_fk
  foreign key (resolution_todo_id) references todos(id) on delete set null;

-- ============================================================
-- Headlines
-- ============================================================
create table headlines (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  title text not null,
  body text,
  kind text not null check (kind in ('customer','employee','cascading')),
  created_by uuid references auth.users(id) on delete set null,
  target_team_ids uuid[] not null default '{}',  -- used when kind = 'cascading'
  created_at timestamptz not null default now()
);

create index headlines_team_idx on headlines(team_id, created_at desc);

-- ============================================================
-- Meetings (L10)
-- ============================================================
create table meetings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  current_segment text not null default 'segue'
    check (current_segment in ('segue','scorecard','rocks','headlines','todos','ids','conclude','done')),
  segment_started_at timestamptz not null default now(),
  notes text
);

create index meetings_team_idx on meetings(team_id, started_at desc);

alter table todos
  add constraint todos_source_meeting_fk
  foreign key (source_meeting_id) references meetings(id) on delete set null;

create table meeting_ratings (
  meeting_id uuid not null references meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score int not null check (score between 1 and 10),
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

-- ============================================================
-- RLS: every tenant table gated on team_members membership
-- ============================================================
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table scorecard_metrics enable row level security;
alter table scorecard_entries enable row level security;
alter table rocks enable row level security;
alter table todos enable row level security;
alter table issues enable row level security;
alter table headlines enable row level security;
alter table meetings enable row level security;
alter table meeting_ratings enable row level security;

-- Helper: is the current user a member of this team?
create or replace function is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

-- profiles: a user can read their own org's profiles + edit their own
create policy profiles_select on profiles for select
  using (org_id = (select org_id from profiles where id = auth.uid()));
create policy profiles_insert_self on profiles for insert
  with check (id = auth.uid());
create policy profiles_update_self on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- organizations: visible only to members
create policy organizations_select on organizations for select
  using (id = (select org_id from profiles where id = auth.uid()));

-- teams: visible if user is in the team's org
create policy teams_select on teams for select
  using (org_id = (select org_id from profiles where id = auth.uid()));

-- team_members: visible if user is in same team OR same org
create policy team_members_select on team_members for select
  using (
    is_team_member(team_id)
    or exists (
      select 1 from teams t
      join profiles p on p.org_id = t.org_id
      where t.id = team_members.team_id and p.id = auth.uid()
    )
  );

-- Generic policies for tenant tables: must be team member
create policy scorecard_metrics_rw on scorecard_metrics for all
  using (is_team_member(team_id)) with check (is_team_member(team_id));

create policy scorecard_entries_rw on scorecard_entries for all
  using (is_team_member((select team_id from scorecard_metrics where id = scorecard_entries.metric_id)))
  with check (is_team_member((select team_id from scorecard_metrics where id = scorecard_entries.metric_id)));

create policy rocks_rw on rocks for all
  using (is_team_member(team_id)) with check (is_team_member(team_id));

create policy todos_rw on todos for all
  using (is_team_member(team_id) and (visibility = 'team' or owner_id = auth.uid()))
  with check (is_team_member(team_id));

create policy issues_rw on issues for all
  using (is_team_member(team_id)) with check (is_team_member(team_id));

create policy headlines_rw on headlines for all
  using (
    is_team_member(team_id)
    or (kind = 'cascading' and exists (
      select 1 from unnest(target_team_ids) as t(id) where is_team_member(t.id)
    ))
  )
  with check (is_team_member(team_id));

create policy meetings_rw on meetings for all
  using (is_team_member(team_id)) with check (is_team_member(team_id));

create policy meeting_ratings_rw on meeting_ratings for all
  using (is_team_member((select team_id from meetings where id = meeting_ratings.meeting_id)))
  with check (
    user_id = auth.uid()
    and is_team_member((select team_id from meetings where id = meeting_ratings.meeting_id))
  );

-- ============================================================
-- Auto-create profile row when an auth.users row is inserted
-- ============================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  -- Default new users to the first org (MVP single-tenant assumption).
  -- Admin assigns them to teams afterward.
  select id into v_org_id from organizations order by created_at limit 1;
  if v_org_id is null then
    return new;  -- no org yet; skip
  end if;
  insert into profiles (id, org_id, full_name, email)
  values (
    new.id,
    v_org_id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
