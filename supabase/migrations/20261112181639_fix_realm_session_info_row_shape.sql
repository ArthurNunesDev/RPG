create or replace function public.get_realm_session(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare session_row private.realm_sessions%rowtype; campaign_title text; members_json jsonb;
begin
 select s.* into session_row from private.realm_sessions s join private.realm_session_members sm on sm.session_id=s.id where s.id=p_session_id and sm.user_id=p_user_id;
 if not found then raise exception 'SESSION_ACCESS_DENIED'; end if;
 select c.title into campaign_title from public.campaigns c where c.id=session_row.campaign_id;
 select coalesce(jsonb_agg(jsonb_build_object('userId',sm.user_id,'displayName',p.display_name,'role',cm.role,'joinedAt',sm.joined_at) order by sm.joined_at),'[]'::jsonb)
 into members_json from private.realm_session_members sm join public.profiles p on p.id=sm.user_id join public.campaign_members cm on cm.campaign_id=session_row.campaign_id and cm.user_id=sm.user_id where sm.session_id=p_session_id;
 return jsonb_build_object('id',session_row.id,'campaignId',session_row.campaign_id,'campaignTitle',campaign_title,'createdBy',session_row.created_by,'status',session_row.status,'pin',case when session_row.created_by=p_user_id then session_row.pin else null end,'members',members_json);
end;
$$;