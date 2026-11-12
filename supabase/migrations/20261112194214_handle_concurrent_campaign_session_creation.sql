create or replace function public.create_realm_session(p_user_id uuid, p_campaign_id uuid, p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_session_id uuid;
begin
  if p_user_id is null or p_campaign_id is null or p_pin !~ '^[A-Z0-9]{8}$' or p_pin !~ '[A-Z]' or p_pin !~ '[0-9]' then
    raise exception 'INVALID_SESSION_DETAILS';
  end if;
  if not exists(select 1 from public.campaign_members cm where cm.campaign_id=p_campaign_id and cm.user_id=p_user_id and cm.role='gm') then
    raise exception 'CAMPAIGN_GM_REQUIRED';
  end if;
  if exists(select 1 from private.realm_sessions s where s.campaign_id=p_campaign_id) then
    raise exception 'CAMPAIGN_SESSION_ALREADY_CREATED';
  end if;
  insert into private.realm_sessions(campaign_id,created_by,pin,status)
  values(p_campaign_id,p_user_id,p_pin,'active') returning id into new_session_id;
  insert into private.realm_session_members(session_id,user_id) values(new_session_id,p_user_id);
  return new_session_id;
exception when unique_violation then
  if exists(select 1 from private.realm_sessions s where s.campaign_id=p_campaign_id) then
    raise exception 'CAMPAIGN_SESSION_ALREADY_CREATED';
  end if;
  raise exception 'SESSION_PIN_TAKEN';
end;
$$;
revoke all on function public.create_realm_session(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_realm_session(uuid,uuid,text) to service_role;