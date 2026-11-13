drop policy if exists "game masters create combat action requests" on public.combat_action_requests;
create policy "game masters create combat action requests" on public.combat_action_requests
for insert to authenticated with check (
 requested_by = (select auth.uid()) and status = 'pending' and resolved_by is null
 and exists (
  select 1 from public.combat_encounters e
  join public.combatants cb on cb.encounter_id = e.id and cb.character_id = actor_character_id
  where e.id = encounter_id and e.status = 'active'
    and cb.is_active and not cb.turn_blocked
    and (select private.is_campaign_gm(e.campaign_id))
 )
);