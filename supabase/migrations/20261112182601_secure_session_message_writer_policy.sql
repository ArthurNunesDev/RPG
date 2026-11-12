create or replace function private.can_send_realm_session_message(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from private.realm_session_members sm
    join private.realm_sessions s on s.id=sm.session_id
    join public.campaign_members cm on cm.campaign_id=s.campaign_id and cm.user_id=sm.user_id
    where sm.session_id=p_session_id
      and sm.user_id=(select auth.uid())
      and s.status='active'
      and cm.role in('gm','player')
  );
$$;
revoke all on function private.can_send_realm_session_message(uuid) from public,anon;
grant execute on function private.can_send_realm_session_message(uuid) to authenticated,service_role;
drop policy if exists "players and GMs send session messages" on public.session_messages;
create policy "players and GMs send session messages"
  on public.session_messages for insert to authenticated
  with check (
    author_id=(select auth.uid())
    and (select private.can_send_realm_session_message(session_id))
  );
