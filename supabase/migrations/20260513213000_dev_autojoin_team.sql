-- Dev/MVP convenience: when a new user signs up, also add them to the first
-- team in their org so they can immediately use the app without manual SQL.
-- Drop or scope this trigger before opening signup to the wider company.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id  uuid;
  v_team_id uuid;
begin
  select id into v_org_id from organizations order by created_at limit 1;
  if v_org_id is null then
    return new;
  end if;

  insert into profiles (id, org_id, full_name, email)
  values (
    new.id,
    v_org_id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  )
  on conflict (id) do nothing;

  select id into v_team_id
    from teams
    where org_id = v_org_id
    order by created_at limit 1;

  if v_team_id is not null then
    insert into team_members (team_id, user_id, role)
    values (v_team_id, new.id, 'member')
    on conflict (team_id, user_id) do nothing;
  end if;

  return new;
end;
$$;
