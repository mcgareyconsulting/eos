-- Per-user issue voting (EOS recommends up to 3 votes per person per team).
-- Replaces the free-form issues.votes integer with a proper join table.
-- issues.votes is kept as a denormalized counter and maintained by trigger.

create table issue_votes (
  issue_id uuid not null references issues(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

create index issue_votes_user_idx on issue_votes(user_id);

alter table issue_votes enable row level security;

create policy issue_votes_select on issue_votes for select
  using (
    is_team_member(
      (select team_id from issues where id = issue_votes.issue_id)
    )
  );

create policy issue_votes_insert on issue_votes for insert
  with check (
    user_id = auth.uid()
    and is_team_member(
      (select team_id from issues where id = issue_votes.issue_id)
    )
  );

create policy issue_votes_delete on issue_votes for delete
  using (user_id = auth.uid());

-- Max 3 votes per user per team (across that team's issues).
create or replace function enforce_issue_vote_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_count int;
begin
  select team_id into v_team from issues where id = new.issue_id;
  select count(*) into v_count
    from issue_votes iv
    join issues i on i.id = iv.issue_id
   where iv.user_id = new.user_id
     and i.team_id = v_team
     and iv.issue_id <> new.issue_id;
  if v_count >= 3 then
    raise exception
      'You already have 3 active votes on this team. Remove one first.';
  end if;
  return new;
end;
$$;

create trigger enforce_issue_vote_limit
  before insert on issue_votes
  for each row execute function enforce_issue_vote_limit();

-- Keep issues.votes in sync as a denormalized count.
create or replace function sync_issue_votes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update issues set votes = votes + 1 where id = new.issue_id;
  elsif tg_op = 'DELETE' then
    update issues set votes = greatest(0, votes - 1) where id = old.issue_id;
  end if;
  return null;
end;
$$;

create trigger sync_issue_votes_count
  after insert or delete on issue_votes
  for each row execute function sync_issue_votes_count();

-- Reset any pre-existing free-form counts (now that issue_votes is canonical).
update issues set votes = 0;
