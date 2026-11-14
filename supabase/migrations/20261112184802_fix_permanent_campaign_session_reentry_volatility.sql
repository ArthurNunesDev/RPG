create or replace function public.get_active_realm_campaign_session(p_user_id uuid, p_campaign_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare permanent_session_id uuid;
begin
 if not exists(select 1 from public.campaign_members cm where cm.campaign_id=p_campaign_id and cm.user_id=p_user_id and cm.role='gm') then raise exception 'CAMPAIGN_GM_REQUIRED'; end if;
 select id into permanent_session_id from private.realm_sessions where campaign_id=p_campaign_id and status='active';
 if permanent_session_id is null then raise exception 'CAMPAIGN_SESSION_PIN_MISSING'; end if;
 insert into private.realm_session_members(session_id,user_id) values(permanent_session_id,p_user_id) on conflict(session_id,user_id) do nothing;
 return public.get_realm_session(p_user_id,permanent_session_id);
end;
$$;
revoke all on function public.get_active_realm_campaign_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_active_realm_campaign_session(uuid,uuid) to service_role;
