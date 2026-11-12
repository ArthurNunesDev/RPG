-- Keep one permanent session and PIN for each campaign.
drop trigger if exists add_campaign_owner_as_gm on public.campaigns;
revoke all on function private.add_campaign_owner_as_gm() from public, anon, authenticated;

drop index if exists private.realm_sessions_one_active_per_campaign_idx;
create unique index if not exists realm_sessions_one_per_campaign_idx
  on private.realm_sessions(campaign_id);

update private.realm_sessions
set status = 'active', ended_at = null
where status <> 'active' or ended_at is not null;

create or replace function private.generate_realm_session_pin()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  random_bytes bytea;
  candidate text;
  byte_index integer;
begin
  for attempt in 1..100 loop
    random_bytes := extensions.gen_random_bytes(8);
    candidate := '';
    for byte_index in 0..7 loop
      candidate := candidate || substr(
        alphabet,
        (get_byte(random_bytes, byte_index) % length(alphabet)) + 1,
        1
      );
    end loop;

    if candidate ~ '[A-Z]'
      and candidate ~ '[0-9]'
      and not exists (
        select 1 from private.realm_sessions s where s.pin = candidate
      )
    then
      return candidate;
    end if;
  end loop;

  raise exception 'REALM_SESSION_PIN_GENERATION_FAILED';
end;
$$;

revoke all on function private.generate_realm_session_pin() from public, anon, authenticated;

create or replace function private.create_campaign_realm_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_session_id uuid;
  new_pin text;
  attempt integer;
begin
  insert into public.campaign_members(campaign_id, user_id, role)
  values (new.id, new.owner_id, 'gm')
  on conflict (campaign_id, user_id) do update set role = 'gm';

  for attempt in 1..10 loop
    new_pin := private.generate_realm_session_pin();
    begin
      insert into private.realm_sessions(campaign_id, created_by, pin, status)
      values (new.id, new.owner_id, new_pin, 'active')
      returning id into new_session_id;
      exit;
    exception when unique_violation then
      if exists (
        select 1 from private.realm_sessions s where s.campaign_id = new.id
      ) then
        raise;
      end if;
    end;
  end loop;

  if new_session_id is null then
    raise exception 'CAMPAIGN_SESSION_CREATION_FAILED';
  end if;

  insert into private.realm_session_members(session_id, user_id)
  values (new_session_id, new.owner_id)
  on conflict (session_id, user_id) do nothing;

  return new;
end;
$$;

revoke all on function private.create_campaign_realm_session() from public, anon, authenticated;

drop trigger if exists create_campaign_realm_session on public.campaigns;
create trigger create_campaign_realm_session
after insert on public.campaigns
for each row execute function private.create_campaign_realm_session();

-- Backfill any campaign without a permanent session.
insert into private.realm_sessions(campaign_id, created_by, pin, status)
select c.id, c.owner_id, private.generate_realm_session_pin(), 'active'
from public.campaigns c
where not exists (
  select 1 from private.realm_sessions s where s.campaign_id = c.id
);

insert into private.realm_session_members(session_id, user_id)
select s.id, s.created_by
from private.realm_sessions s
on conflict (session_id, user_id) do nothing;

-- Only accounts configured for the GM experience may create campaigns.
drop policy if exists "users create their own campaigns" on public.campaigns;
drop policy if exists "game masters create their own campaigns" on public.campaigns;
create policy "game masters create their own campaigns"
on public.campaigns
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.preferred_role = 'gm'
  )
  and exists (
    select 1
    from public.game_systems gs
    where gs.id = campaigns.game_system_id
      and (gs.is_official or gs.created_by = (select auth.uid()))
  )
);

-- Reopening a campaign returns its original session and PIN.
create or replace function public.get_active_realm_campaign_session(p_user_id uuid, p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  permanent_session_id uuid;
begin
  if not exists (
    select 1 from public.campaign_members cm
    where cm.campaign_id = p_campaign_id
      and cm.user_id = p_user_id
      and cm.role = 'gm'
  ) then
    raise exception 'CAMPAIGN_GM_REQUIRED';
  end if;

  select s.id into permanent_session_id
  from private.realm_sessions s
  where s.campaign_id = p_campaign_id
    and s.status = 'active';

  if permanent_session_id is null then
    raise exception 'CAMPAIGN_SESSION_PIN_MISSING';
  end if;

  insert into private.realm_session_members(session_id, user_id)
  values (permanent_session_id, p_user_id)
  on conflict (session_id, user_id) do nothing;

  return public.get_realm_session(p_user_id, permanent_session_id);
end;
$$;

-- Leaving the room never ends or invalidates its campaign PIN.
create or replace function public.leave_realm_session(p_user_id uuid, p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.realm_session_members
  where session_id = p_session_id
    and user_id = p_user_id;
  return found;
end;
$$;

-- Sessions cannot be ended separately from their campaigns.
create or replace function public.end_realm_session(p_user_id uuid, p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'CAMPAIGN_SESSION_PIN_PERMANENT';
end;
$$;

-- Joining by PIN reactivates a participant link if the GM previously removed it.
create or replace function public.join_realm_session(p_user_id uuid, p_pin text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session private.realm_sessions%rowtype;
  existing_role text;
begin
  if p_user_id is null
    or p_pin !~ '^[A-Z0-9]{8}$'
    or p_role not in ('player', 'observer')
  then
    raise exception 'INVALID_SESSION_DETAILS';
  end if;

  select * into target_session
  from private.realm_sessions
  where pin = p_pin and status = 'active'
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  select cm.role into existing_role
  from public.campaign_members cm
  where cm.campaign_id = target_session.campaign_id
    and cm.user_id = p_user_id;

  if existing_role is null then
    insert into public.campaign_members(campaign_id, user_id, role)
    values (target_session.campaign_id, p_user_id, p_role);
  end if;

  insert into private.realm_session_members(session_id, user_id)
  values (target_session.id, p_user_id)
  on conflict (session_id, user_id) do nothing;

  return target_session.id;
end;
$$;

revoke all on function public.get_active_realm_campaign_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_active_realm_campaign_session(uuid, uuid) to service_role;
