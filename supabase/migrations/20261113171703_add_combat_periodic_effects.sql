create table if not exists public.combat_effects (
 id uuid primary key default gen_random_uuid(),
 encounter_id uuid not null references public.combat_encounters(id) on delete cascade,
 target_character_id uuid not null,
 target_name text not null,
 effect_name text not null,
 effect_type text not null default 'damage',
 damage_per_round integer not null default 0 check (damage_per_round >= 0),
 healing_per_round integer not null default 0 check (healing_per_round >= 0),
 remaining_rounds integer not null check (remaining_rounds > 0),
 source_name text,
 applied_round integer not null default 1,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (damage_per_round = 0 or healing_per_round = 0)
);
create index if not exists combat_effects_active_idx on public.combat_effects(encounter_id,target_character_id) where remaining_rounds > 0;
alter table public.combat_effects enable row level security;
grant select,insert,update,delete on public.combat_effects to authenticated;
drop policy if exists "session members read combat effects" on public.combat_effects;
create policy "session members read combat effects" on public.combat_effects for select to authenticated using (
 exists(select 1 from public.combat_encounters e where e.id=encounter_id and (select private.is_realm_session_member(e.session_id)))
);
drop policy if exists "game masters manage combat effects" on public.combat_effects;
create policy "game masters manage combat effects" on public.combat_effects for all to authenticated using (
 exists(select 1 from public.combat_encounters e where e.id=encounter_id and (select private.is_campaign_gm(e.campaign_id)))
) with check (
 created_by=(select auth.uid()) and exists(select 1 from public.combat_encounters e where e.id=encounter_id and (select private.is_campaign_gm(e.campaign_id)))
);