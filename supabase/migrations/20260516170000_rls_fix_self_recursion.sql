-- Several RLS policies reference `profiles` from inside subqueries, e.g.
-- `org_id = (select org_id from profiles where id = auth.uid())`.
-- Postgres applies RLS to that subquery too, which references `profiles`,
-- which applies its own RLS, etc. — the planner returns 0 rows instead of
-- looping, so users see nothing. Replace those subqueries with a
-- SECURITY DEFINER helper that bypasses RLS for the org lookup.

create or replace function current_user_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid()
$$;

grant execute on function current_user_org_id() to authenticated;

-- profiles: self + same-org
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (id = auth.uid() or org_id = current_user_org_id());

-- organizations: only the user's org
drop policy if exists organizations_select on organizations;
create policy organizations_select on organizations for select
  using (id = current_user_org_id());

-- teams: visible if in user's org
drop policy if exists teams_select on teams;
create policy teams_select on teams for select
  using (org_id = current_user_org_id());

-- team_members: visible if same team OR same org (via team's org)
drop policy if exists team_members_select on team_members;
create policy team_members_select on team_members for select
  using (
    is_team_member(team_id)
    or exists (
      select 1 from teams t
      where t.id = team_members.team_id and t.org_id = current_user_org_id()
    )
  );
