drop policy if exists "session members read combat action requests" on public.combat_action_requests;
create policy "owners and GMs read combat action requests" on public.combat_action_requests
for select to authenticated using (
 requested_by=(select auth.uid()) or exists (
  select 1 from public.combat_encounters e
  where e.id=encounter_id and (select private.is_campaign_gm(e.campaign_id))
 )
);