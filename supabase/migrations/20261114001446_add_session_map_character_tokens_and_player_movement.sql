alter table public.session_map_states
  add column if not exists allow_player_movement boolean not null default false;

revoke update on public.session_map_states from authenticated;
grant update (active_map_id, is_open, updated_by, updated_at, view_zoom, view_offset_x, view_offset_y, allow_player_movement)
  on public.session_map_states to authenticated;

create table if not exists public.session_map_tokens (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references private.realm_sessions(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  map_id uuid not null references public.campaign_maps(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete set null,
  x numeric(7,6) not null default 0.5 check (x between 0 and 1),
  y numeric(7,6) not null default 0.5 check (y between 0 and 1),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (map_id, character_id)
);

create index if not exists session_map_tokens_session_map_idx
  on public.session_map_tokens(session_id, map_id);

alter table public.session_map_tokens enable row level security;
revoke all on public.session_map_tokens from public, anon;
grant select, insert, delete on public.session_map_tokens to authenticated;
grant update (x, y, updated_by, updated_at) on public.session_map_tokens to authenticated;

create policy "approved map participants read visible character tokens"
  on public.session_map_tokens for select to authenticated
  using (
    (select private.is_campaign_gm(campaign_id))
    or (
      (select private.is_realm_session_member(session_id))
      and exists (
        select 1
        from public.session_map_access_requests r
        join public.session_map_states st on st.session_id = r.session_id
        where r.session_id = session_map_tokens.session_id
          and r.map_id = session_map_tokens.map_id
          and r.user_id = (select auth.uid())
          and r.status = 'approved'
          and st.active_map_id = session_map_tokens.map_id
          and st.is_open
      )
      and exists (
        select 1 from public.characters c
        where c.id = session_map_tokens.character_id
          and c.campaign_id = session_map_tokens.campaign_id
          and c.campaign_approval_status = 'approved'
          and (c.owner_id = (select auth.uid()) or c.is_visible_to_players)
      )
    )
  );

create policy "GMs add and remove map character tokens"
  on public.session_map_tokens for insert to authenticated
  with check (
    (select private.is_campaign_gm(campaign_id))
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and exists (
      select 1 from private.realm_sessions s
      where s.id = session_id and s.campaign_id = campaign_id
    )
    and exists (
      select 1 from public.campaign_maps m
      where m.id = map_id and m.campaign_id = campaign_id
    )
    and exists (
      select 1 from public.characters c
      where c.id = character_id and c.campaign_id = campaign_id
        and c.campaign_approval_status = 'approved'
    )
  );

create policy "GMs and authorized players move map character tokens"
  on public.session_map_tokens for update to authenticated
  using (
    (select private.is_campaign_gm(campaign_id))
    or (
      owner_id = (select auth.uid())
      and exists (
        select 1
        from public.session_map_states st
        join public.session_map_access_requests r
          on r.session_id = st.session_id and r.map_id = st.active_map_id
        join public.campaign_members cm
          on cm.campaign_id = st.campaign_id and cm.user_id = (select auth.uid())
        join public.characters c
          on c.id = session_map_tokens.character_id
        where st.session_id = session_map_tokens.session_id
          and st.campaign_id = session_map_tokens.campaign_id
          and st.active_map_id = session_map_tokens.map_id
          and st.is_open
          and st.allow_player_movement
          and r.user_id = (select auth.uid())
          and r.status = 'approved'
          and cm.role = 'player'
          and c.owner_id = (select auth.uid())
          and c.character_type = 'player'
          and c.campaign_approval_status = 'approved'
      )
    )
  )
  with check (
    updated_by = (select auth.uid())
    and (
      (select private.is_campaign_gm(campaign_id))
      or (
        owner_id = (select auth.uid())
        and exists (
          select 1
          from public.session_map_states st
          join public.session_map_access_requests r
            on r.session_id = st.session_id and r.map_id = st.active_map_id
          join public.campaign_members cm
            on cm.campaign_id = st.campaign_id and cm.user_id = (select auth.uid())
          join public.characters c
            on c.id = session_map_tokens.character_id
          where st.session_id = session_map_tokens.session_id
            and st.campaign_id = session_map_tokens.campaign_id
            and st.active_map_id = session_map_tokens.map_id
            and st.is_open
            and st.allow_player_movement
            and r.user_id = (select auth.uid())
            and r.status = 'approved'
            and cm.role = 'player'
            and c.owner_id = (select auth.uid())
            and c.character_type = 'player'
            and c.campaign_approval_status = 'approved'
        )
      )
    )
  );

create policy "GMs delete map character tokens"
  on public.session_map_tokens for delete to authenticated
  using ((select private.is_campaign_gm(campaign_id)));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'session_map_tokens'
     ) then
    alter publication supabase_realtime add table public.session_map_tokens;
  end if;
end $$;
