drop policy if exists "players request own combat actions" on public.combat_action_requests;
create policy "players request own combat actions" on public.combat_action_requests
for insert to authenticated with check (
 requested_by=(select auth.uid()) and status='pending' and resolved_by is null
 and exists (
  select 1 from public.combat_encounters e
  join public.characters c on c.id=actor_character_id
  join public.combatants cb on cb.encounter_id=e.id and cb.character_id=c.id
  where e.id=encounter_id and e.status='active' and e.turns_paused=false
   and c.owner_id=(select auth.uid()) and c.character_type='player'
   and cb.is_active and cb.turn_blocked=false and cb.turn_control='player'
   and (
    cb.id=(select current_cb.id from public.combatants current_cb
      where current_cb.encounter_id=e.id and current_cb.is_active and not current_cb.turn_blocked
      order by current_cb.turn_order asc limit 1 offset e.turn_index)
    or (
      action_type in ('dodge','counterattack','defend')
      and coalesce((cb.actions_used->>'reaction')::boolean,false)=false
      and not exists (
        select 1 from public.combat_action_requests pending
        where pending.encounter_id=e.id and pending.actor_character_id=c.id
          and pending.action_type in ('dodge','counterattack','defend') and pending.status='pending'
      )
    )
   )
 )
);