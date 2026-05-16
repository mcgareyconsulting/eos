-- Self-heal helper: if a signed-in user is missing a profile or team membership
-- (e.g. the on_auth_user_created trigger didn't fire for some reason), this
-- RPC creates them. Idempotent. Safe to call on every authenticated request.

create or replace function ensure_user_provisioned()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email   text;
  v_first   text;
  v_last    text;
  v_org_id  uuid;
  v_team_id uuid;
begin
  if v_user_id is null then
    return;
  end if;

  if exists (select 1 from profiles where id = v_user_id) then
    return;
  end if;

  select email,
         raw_user_meta_data->>'first_name',
         raw_user_meta_data->>'last_name'
    into v_email, v_first, v_last
    from auth.users where id = v_user_id;

  v_first := coalesce(nullif(v_first, ''), split_part(v_email, '@', 1));
  v_last  := coalesce(v_last, '');

  select id into v_org_id from organizations order by created_at limit 1;
  if v_org_id is null then
    return;
  end if;

  insert into profiles (id, org_id, first_name, last_name, email)
  values (v_user_id, v_org_id, v_first, v_last, v_email)
  on conflict (id) do nothing;

  select id into v_team_id
    from teams where org_id = v_org_id order by created_at limit 1;

  if v_team_id is not null then
    insert into team_members (team_id, user_id, role)
    values (v_team_id, v_user_id, 'member')
    on conflict (team_id, user_id) do nothing;
  end if;
end;
$$;

grant execute on function ensure_user_provisioned() to authenticated;
