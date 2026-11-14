drop trigger if exists add_campaign_owner_as_gm on public.campaigns;
revoke all on function private.add_campaign_owner_as_gm() from public, anon, authenticated;

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
