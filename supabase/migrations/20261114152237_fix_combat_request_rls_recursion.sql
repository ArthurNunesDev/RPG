-- Break recursive RLS evaluation when checking duplicate pending reactions.
create or replace function private.has_pending_combat_reaction(
  p_encounter_id uuid,
  p_character_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = 'off'
as $$
  select exists (
    select 1
    from public.combat_action_requests r
    where r.encounter_id = p_encounter_id
      and r.actor_character_id = p_character_id
      and r.action_type in ('dodge','counterattack','defend')
      and r.status = 'pending'
  );
$$;

revoke all on function private.has_pending_combat_reaction(uuid,uuid) from public, anon;
grant execute on function private.has_pending_combat_reaction(uuid,uuid) to authenticated;

drop policy if exists "players request own combat actions" on public.combat_action_requests;
create policy "players request own combat actions"
  on public.combat_action_requests
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and status = 'pending'
    and resolved_by is null
    and exists (
      select 1
      from public.combat_encounters e
      join public.characters c on c.id = combat_action_requests.actor_character_id
      join public.combatants cb
        on cb.encounter_id = e.id
       and cb.character_id = c.id
      where e.id = combat_action_requests.encounter_id
        and e.status = 'active'
        and e.turns_paused = false
        and c.owner_id = (select auth.uid())
        and c.character_type = 'player'
        and cb.is_active
        and cb.turn_blocked = false
        and cb.turn_control = 'player'
        and (select private.is_realm_session_member(e.session_id))
        and (
          cb.id = (
            select current_cb.id
            from public.combatants current_cb
            where current_cb.encounter_id = e.id
              and current_cb.is_active
              and not current_cb.turn_blocked
            order by current_cb.turn_order
            offset e.turn_index
            limit 1
          )
          or (
            combat_action_requests.action_type in ('dodge','counterattack','defend')
            and coalesce((cb.actions_used->>'reaction')::boolean, false) = false
            and not (select private.has_pending_combat_reaction(e.id, c.id))
          )
        )
    )
  );
