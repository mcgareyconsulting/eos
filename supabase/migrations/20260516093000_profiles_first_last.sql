-- Split profile name into first_name + last_name.
-- full_name becomes a generated column so existing code that reads it keeps working.

alter table profiles add column first_name text;
alter table profiles add column last_name text;

-- Backfill from existing full_name (idempotent split on first space).
update profiles
  set first_name = coalesce(split_part(full_name, ' ', 1), ''),
      last_name  = case
                     when position(' ' in full_name) > 0
                     then substring(full_name from position(' ' in full_name) + 1)
                     else ''
                   end
  where first_name is null;

alter table profiles alter column first_name set not null;
alter table profiles alter column last_name set not null;

-- Replace full_name with a generated column.
alter table profiles drop column full_name;
alter table profiles add column full_name text
  generated always as (trim(both ' ' from first_name || ' ' || last_name)) stored;

-- Update the auto-profile trigger to write first/last directly.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id  uuid;
  v_team_id uuid;
  v_first   text;
  v_last    text;
begin
  select id into v_org_id from organizations order by created_at limit 1;
  if v_org_id is null then
    return new;
  end if;

  v_first := coalesce(new.raw_user_meta_data->>'first_name', '');
  v_last  := coalesce(new.raw_user_meta_data->>'last_name',  '');

  -- If only full_name was supplied (older clients), split it on the first space.
  if v_first = '' and v_last = '' then
    declare
      v_full text := coalesce(new.raw_user_meta_data->>'full_name', new.email);
    begin
      v_first := split_part(v_full, ' ', 1);
      v_last  := case
                   when position(' ' in v_full) > 0
                   then substring(v_full from position(' ' in v_full) + 1)
                   else ''
                 end;
    end;
  end if;

  insert into profiles (id, org_id, first_name, last_name, email)
  values (new.id, v_org_id, v_first, v_last, new.email)
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
