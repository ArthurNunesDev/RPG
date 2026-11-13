-- Shared battle map access, GM-controlled map state, and persistent annotations.
create table if not exists public.session_map_access_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references private.realm_sessions(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  map_id uuid not null references public.campaign_maps(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null
);
create unique index if not exists session_map_access_one_pending_idx
  on public.session_map_access_requests(session_id, map_id, user_id) where status = 'pending';
create index if not exists session_map_access_requests_gm_idx
  on public.session_map_access_requests(session_id, status, requested_at desc);
alter table public.session_map_access_requests enable row level security;
revoke all on public.session_map_access_requests from public, anon;
grant select, insert, update on public.session_map_access_requests to authenticated;
create policy "participants read own map requests and GMs read all"
  on public.session_map_access_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_campaign_gm(campaign_id)));
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
      where m.id = map_id and m.campaign_id = campaign_id
    )
  );
create policy "GMs decide map access requests"
  on public.session_map_access_requests for update to authenticated
  using ((select private.is_campaign_gm(campaign_id)))
  with check (
    (select private.is_campaign_gm(campaign_id))
    and status in ('approved','rejected')
    and decided_by = (select auth.uid())
    and decided_at is not null
  );

create table if not exists public.session_map_states (
  session_id uuid primary key references private.realm_sessions(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  active_map_id uuid references public.campaign_maps(id) on delete set null,
  is_open boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.session_map_states enable row level security;
revoke all on public.session_map_states from public, anon;
grant select, insert, update on public.session_map_states to authenticated;
create policy "session members read shared map state"
  on public.session_map_states for select to authenticated
  using ((select private.is_realm_session_member(session_id)));
create policy "GMs control shared map state"
  on public.session_map_states for all to authenticated
  using ((select private.is_campaign_gm(campaign_id)))
  with check (
    (select private.is_campaign_gm(campaign_id))
    and updated_by = (select auth.uid())
    and exists (
      select 1 from private.realm_sessions s
      where s.id = session_id and s.campaign_id = campaign_id
    )
    and (
      active_map_id is null
      or exists (select 1 from public.campaign_maps m where m.id = active_map_id and m.campaign_id = campaign_id)
    )
  );

create table if not exists public.session_map_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references private.realm_sessions(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  map_id uuid not null references public.campaign_maps(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  annotation_type text not null check (annotation_type in ('marker','text','drawing')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint session_map_annotations_payload_size check (pg_column_size(payload) <= 32768)
);
create index if not exists session_map_annotations_lookup_idx
  on public.session_map_annotations(session_id, map_id, created_at);
alter table public.session_map_annotations enable row level security;
revoke all on public.session_map_annotations from public, anon;
grant select, insert, update, delete on public.session_map_annotations to authenticated;
create policy "approved participants read shared map annotations"
  on public.session_map_annotations for select to authenticated
  using (
    (select private.is_campaign_gm(campaign_id))
    or (
      (select private.is_realm_session_member(session_id))
      and exists (
        select 1 from public.session_map_access_requests r
        where r.session_id = session_map_annotations.session_id
          and r.map_id = session_map_annotations.map_id
          and r.user_id = (select auth.uid())
          and r.status = 'approved'
      )
      and exists (
        select 1 from public.session_map_states st
        where st.session_id = session_map_annotations.session_id
          and st.active_map_id = session_map_annotations.map_id
          and st.is_open
      )
    )
  );
create policy "GMs manage map annotations"
  on public.session_map_annotations for all to authenticated
  using ((select private.is_campaign_gm(campaign_id)))
  with check (
    (select private.is_campaign_gm(campaign_id))
    and created_by = (select auth.uid())
    and exists (
      select 1 from private.realm_sessions s
      where s.id = session_id and s.campaign_id = campaign_id
    )
    and exists (
      select 1 from public.campaign_maps m
      where m.id = map_id and m.campaign_id = campaign_id
    )
  );

-- Restrict map image downloads to the GM or participants approved for the currently open map.
drop policy if exists "campaign members read campaign assets" on storage.objects;
create policy "campaign members read campaign assets"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'campaign-assets'
    and (
      not exists (select 1 from public.campaign_maps m where m.storage_path = name)
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

do $$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='session_map_access_requests') then
      alter publication supabase_realtime add table public.session_map_access_requests;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='session_map_states') then
      alter publication supabase_realtime add table public.session_map_states;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='session_map_annotations') then
      alter publication supabase_realtime add table public.session_map_annotations;
    end if;
  end if;
end $$;
