create table if not exists public.combat_encounters (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references private.realm_sessions(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  game_system text not null default 'ordem-paranormal',
  status text not null default 'active' check (status in ('active','completed')),
  round_number integer not null default 1 check (round_number > 0),
  turn_index integer not null default 0 check (turn_index >= 0),
  started_by uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists combat_one_active_encounter_per_session on public.combat_encounters(session_id) where status = 'active';
create index if not exists combat_encounters_campaign_recent_idx on public.combat_encounters(campaign_id, created_at desc);

create table if not exists public.combatants (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.combat_encounters(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  character_name text not null,
  owner_id uuid not null references auth.users(id),
  side text not null check (side in ('players','enemies','allies','neutral')),
  initiative integer not null default 0,
  initiative_rolls jsonb not null default '[]'::jsonb check (jsonb_typeof(initiative_rolls) = 'array'),
  is_surprised boolean not null default false,
  is_active boolean not null default true,
  current_hp integer not null default 0,
  max_hp integer not null default 0,
  current_pe integer not null default 0,
  max_pe integer not null default 0,
  current_pd integer not null default 0,
  max_pd integer not null default 0,
  actions_used jsonb not null default '{"standard":false,"movement":false,"reaction":false}'::jsonb,
  conditions text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(encounter_id, character_id)
);
create index if not exists combatants_turn_order_idx on public.combatants(encounter_id, initiative desc, sort_order asc);

create table if not exists public.combat_events (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.combat_encounters(id) on delete cascade,
  actor_character_id uuid references public.characters(id) on delete set null,
  target_character_id uuid references public.characters(id) on delete set null,
  actor_name text not null,
  target_name text,
  event_type text not null check (event_type in ('initiative','attack','damage','healing','ability','reaction','turn','condition','system','disaster')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists combat_events_encounter_recent_idx on public.combat_events(encounter_id, created_at desc);

create table if not exists public.combat_action_requests (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.combat_encounters(id) on delete cascade,
  actor_character_id uuid not null references public.characters(id) on delete cascade,
  target_character_id uuid references public.characters(id) on delete set null,
  action_id text not null,
  action_type text not null check (action_type in ('attack','ability','dodge','counterattack','defend')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending','resolved','rejected','cancelled')),
  requested_by uuid not null references auth.users(id),
  resolved_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists combat_action_requests_pending_idx on public.combat_action_requests(encounter_id, status, requested_at);

alter table public.combat_encounters enable row level security;
alter table public.combatants enable row level security;
alter table public.combat_events enable row level security;
alter table public.combat_action_requests enable row level security;
revoke all on public.combat_encounters, public.combatants, public.combat_events, public.combat_action_requests from anon;
grant select, insert, update, delete on public.combat_encounters, public.combatants, public.combat_events, public.combat_action_requests to authenticated;

create policy "session members read combat encounters" on public.combat_encounters for select to authenticated using ((select private.is_realm_session_member(session_id)));
create policy "game masters manage combat encounters" on public.combat_encounters for all to authenticated using ((select private.is_campaign_gm(campaign_id))) with check ((select private.is_campaign_gm(campaign_id)));
create policy "session members read combatants" on public.combatants for select to authenticated using (exists (select 1 from public.combat_encounters e where e.id = encounter_id and (select private.is_realm_session_member(e.session_id))));
create policy "game masters manage combatants" on public.combatants for all to authenticated using (exists (select 1 from public.combat_encounters e where e.id = encounter_id and (select private.is_campaign_gm(e.campaign_id)))) with check (exists (select 1 from public.combat_encounters e where e.id = encounter_id and (select private.is_campaign_gm(e.campaign_id))));
create policy "session members read combat events" on public.combat_events for select to authenticated using (exists (select 1 from public.combat_encounters e where e.id = encounter_id and (select private.is_realm_session_member(e.session_id))));
create policy "game masters write combat events" on public.combat_events for insert to authenticated with check (created_by = (select auth.uid()) and exists (select 1 from public.combat_encounters e where e.id = encounter_id and (select private.is_campaign_gm(e.campaign_id))));
create policy "players request own combat actions" on public.combat_action_requests for insert to authenticated with check (
  requested_by = (select auth.uid()) and status = 'pending' and resolved_by is null
  and exists (
    select 1 from public.combat_encounters e
    join public.characters c on c.id = actor_character_id
    join public.combatants cb on cb.encounter_id = e.id and cb.character_id = c.id
    where e.id = encounter_id and e.status = 'active' and c.owner_id = (select auth.uid())
      and c.character_type = 'player' and cb.is_active
      and (select private.is_realm_session_member(e.session_id))
  )
);
create policy "session members read combat action requests" on public.combat_action_requests for select to authenticated using (exists (select 1 from public.combat_encounters e where e.id = encounter_id and (select private.is_realm_session_member(e.session_id))));
create policy "game masters resolve combat action requests" on public.combat_action_requests for update to authenticated using (exists (select 1 from public.combat_encounters e where e.id = encounter_id and (select private.is_campaign_gm(e.campaign_id)))) with check (resolved_by = (select auth.uid()) and status in ('resolved','rejected','cancelled') and exists (select 1 from public.combat_encounters e where e.id = encounter_id and (select private.is_campaign_gm(e.campaign_id))));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='combat_encounters') then alter publication supabase_realtime add table public.combat_encounters; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='combatants') then alter publication supabase_realtime add table public.combatants; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='combat_events') then alter publication supabase_realtime add table public.combat_events; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='combat_action_requests') then alter publication supabase_realtime add table public.combat_action_requests; end if;
  end if;
end;
$$;
