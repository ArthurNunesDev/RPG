-- Keep non-map campaign assets private to campaign members and require an open map before requesting access.
drop policy if exists "session participants request map access" on public.session_map_access_requests;
create policy "session participants request map access"
  on public.session_map_access_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and decided_at is null
    and decided_by is null
    and (select private.is_realm_session_member(session_id))
    and not (select private.is_campaign_gm(campaign_id))
    and exists (
      select 1 from private.realm_sessions s
      where s.id = session_id and s.campaign_id = campaign_id and s.status = 'active'
    )
    and exists (
      select 1 from public.campaign_maps m
      join public.session_map_states st on st.session_id = session_map_access_requests.session_id
      where m.id = map_id and m.campaign_id = campaign_id and m.is_visible
        and st.active_map_id = m.id and st.is_open
    )
  );

drop policy if exists "campaign members read campaign assets" on storage.objects;
create policy "campaign members read campaign assets"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'campaign-assets'
    and (
      (
        not exists (select 1 from public.campaign_maps m where m.storage_path = name)
        and exists (
          select 1 from public.campaign_members cm
          where cm.campaign_id = ((storage.foldername(name))[1])::uuid
            and cm.user_id = (select auth.uid())
        )
      )
      or exists (
        select 1 from public.campaign_maps m
        where m.storage_path = name
          and (select private.is_campaign_gm(m.campaign_id))
      )
      or exists (
        select 1
        from public.campaign_maps m
        join public.session_map_access_requests r on r.map_id = m.id
        join public.session_map_states st on st.session_id = r.session_id and st.active_map_id = m.id
        where m.storage_path = name
          and r.user_id = (select auth.uid())
          and r.status = 'approved'
          and st.is_open
          and (select private.is_realm_session_member(r.session_id))
      )
    )
  );
