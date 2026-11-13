create table if not exists public.combatant_sheets (
  combatant_id uuid primary key references public.combatants(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  sheet_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.combatant_sheets(combatant_id,character_id,owner_id,sheet_snapshot)
select id,character_id,owner_id,sheet_snapshot from public.combatants
where sheet_snapshot is not null and sheet_snapshot <> '{}'::jsonb
on conflict(combatant_id) do update set sheet_snapshot=excluded.sheet_snapshot,updated_at=now();
alter table public.combatant_sheets enable row level security;
revoke all on public.combatant_sheets from anon;
grant select,insert,update,delete on public.combatant_sheets to authenticated;
create policy "owners and GMs read combatant sheets" on public.combatant_sheets
for select to authenticated using (
 owner_id=(select auth.uid()) or exists (
  select 1 from public.combatants cb join public.combat_encounters e on e.id=cb.encounter_id
  where cb.id=combatant_id and (select private.is_campaign_gm(e.campaign_id))
 )
);
create policy "GMs manage combatant sheets" on public.combatant_sheets
for all to authenticated using (
 exists (select 1 from public.combatants cb join public.combat_encounters e on e.id=cb.encounter_id
  where cb.id=combatant_id and (select private.is_campaign_gm(e.campaign_id)))
) with check (
 exists (select 1 from public.combatants cb join public.combat_encounters e on e.id=cb.encounter_id
  where cb.id=combatant_id and (select private.is_campaign_gm(e.campaign_id)))
);
alter table public.combatants drop column if exists sheet_snapshot;
do $$
begin
 if exists (select 1 from pg_publication where pubname='supabase_realtime') and
   not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='combatant_sheets') then
   alter publication supabase_realtime add table public.combatant_sheets;
 end if;
end;
$$;