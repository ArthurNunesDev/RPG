-- A hidden map must stop being readable, including its saved annotations.
drop policy if exists "approved participants read shared map annotations" on public.session_map_annotations;
create policy "approved participants read shared map annotations"
  on public.session_map_annotations for select to authenticated
  using (
    (select private.is_campaign_gm(session_map_annotations.campaign_id))
    or (
      (select private.is_realm_session_member(session_map_annotations.session_id))
      and exists (
        select 1 from public.session_map_access_requests r
        where r.session_id = session_map_annotations.session_id
          and r.map_id = session_map_annotations.map_id
          and r.user_id = (select auth.uid())
          and r.status = 'approved'
      )
      and exists (
        select 1 from public.session_map_states st
        join public.campaign_maps m on m.id = st.active_map_id
        where st.session_id = session_map_annotations.session_id
          and st.active_map_id = session_map_annotations.map_id
          and st.is_open and m.is_visible
      )
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
          and m.is_visible
          and r.user_id = (select auth.uid())
          and r.status = 'approved'
          and st.is_open
          and (select private.is_realm_session_member(r.session_id))
      )
    )
  );
