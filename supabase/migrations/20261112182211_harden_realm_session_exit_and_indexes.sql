create index if not exists realm_sessions_created_by_idx on private.realm_sessions(created_by);
create index if not exists characters_game_system_id_idx on public.characters(game_system_id);
create index if not exists session_messages_author_id_idx on public.session_messages(author_id);
create index if not exists campaign_messages_author_id_idx on public.campaign_messages(author_id);

create or replace function public.leave_realm_session(p_user_id uuid,p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.realm_sessions where id=p_session_id and created_by=p_user_id and status='active') then
  raise exception 'SESSION_CREATOR_MUST_END';
 end if;
 delete from private.realm_session_members where session_id=p_session_id and user_id=p_user_id;
 return found;
end;
$$;