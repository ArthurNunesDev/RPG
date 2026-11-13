-- Explicitly bind every policy check to its owning row to prevent cross-campaign references.
drop policy if exists "session participants request map access" on public.session_map_access_requests;
create policy "session participants request map access"
  on public.session_map_access_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and decided_at is null
    and decided_by is null
    and (select private.is_realm_session_member(session_map_access_requests.session_id))
    and not (select private.is_campaign_gm(session_map_access_requests.campaign_id))
    and exists (
      select 1 from private.realm_sessions s
      where s.id = session_map_access_requests.session_id
        and s.campaign_id = session_map_access_requests.campaign_id
        and s.status = 'active'
    )
    and exists (
      select 1 from public.campaign_maps m
      join public.session_map_states st
        on st.session_id = session_map_access_requests.session_id
      where m.id = session_map_access_requests.map_id
        and m.campaign_id = session_map_access_requests.campaign_id
        and m.is_visible
        and st.active_map_id = m.id
        and st.is_open
    )
  );

drop policy if exists "GMs control shared map state" on public.session_map_states;
create policy "GMs control shared map state"
  on public.session_map_states for all to authenticated
  using ((select private.is_campaign_gm(session_map_states.campaign_id)))
  with check (
    (select private.is_campaign_gm(session_map_states.campaign_id))
    and updated_by = (select auth.uid())
    and exists (
      select 1 from private.realm_sessions s
      where s.id = session_map_states.session_id
        and s.campaign_id = session_map_states.campaign_id
    )
    and (
      active_map_id is null
      or exists (
        select 1 from public.campaign_maps m
        where m.id = session_map_states.active_map_id
          and m.campaign_id = session_map_states.campaign_id
      )
    )
  );

drop policy if exists "GMs manage map annotations" on public.session_map_annotations;
create policy "GMs manage map annotations"
  on public.session_map_annotations for all to authenticated
  using ((select private.is_campaign_gm(session_map_annotations.campaign_id)))
  with check (
    (select private.is_campaign_gm(session_map_annotations.campaign_id))
    and created_by = (select auth.uid())
    and exists (
      select 1 from private.realm_sessions s
      where s.id = session_map_annotations.session_id
        and s.campaign_id = session_map_annotations.campaign_id
    )
    and exists (
      select 1 from public.campaign_maps m
      where m.id = session_map_annotations.map_id
        and m.campaign_id = session_map_annotations.campaign_id
    )
  );
