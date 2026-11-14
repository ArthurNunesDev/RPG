create or replace function public.swap_combatant_turn_order(
  p_encounter_id uuid,
  p_first_combatant_id uuid,
  p_second_combatant_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_encounter public.combat_encounters%rowtype;
  v_first public.combatants%rowtype;
  v_second public.combatants%rowtype;
begin
  if p_first_combatant_id = p_second_combatant_id then
    raise exception 'Selecione dois combatentes diferentes.';
  end if;

  select * into v_encounter
  from public.combat_encounters
  where id = p_encounter_id
  for update;
  if not found or v_encounter.status <> 'active' then
    raise exception 'Combate não está ativo.';
  end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then
    raise exception 'Apenas o mestre pode reorganizar a iniciativa.';
  end if;

  select * into v_first
  from public.combatants
  where id = p_first_combatant_id and encounter_id = p_encounter_id
  for update;
  if not found then raise exception 'Primeiro combatente não pertence a este combate.'; end if;

  select * into v_second
  from public.combatants
  where id = p_second_combatant_id and encounter_id = p_encounter_id
  for update;
  if not found then raise exception 'Segundo combatente não pertence a este combate.'; end if;

  update public.combatants
  set turn_order = case
        when id = v_first.id then v_second.turn_order
        when id = v_second.id then v_first.turn_order
      end,
      updated_at = now()
  where id in (v_first.id, v_second.id);
end;
$$;

revoke all on function public.swap_combatant_turn_order(uuid,uuid,uuid) from public, anon;
grant execute on function public.swap_combatant_turn_order(uuid,uuid,uuid) to authenticated;
