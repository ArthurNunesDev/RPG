create or replace function public.set_combatant_turn_state(
  p_combatant_id uuid,
  p_turn_blocked boolean,
  p_is_active boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_combatant public.combatants%rowtype;
  v_encounter public.combat_encounters%rowtype;
  v_current_id uuid;
  v_next_id uuid;
  v_next_index integer;
  v_count integer;
  v_advance_round boolean := false;
begin
  select e.* into v_encounter
  from public.combat_encounters e
  join public.combatants cb on cb.encounter_id=e.id
  where cb.id=p_combatant_id
  for update of e;
  if not found or v_encounter.status <> 'active' then raise exception 'Combate não está ativo.'; end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then raise exception 'Apenas o mestre pode alterar turnos.'; end if;

  select cb.id into v_current_id
  from public.combatants cb
  where cb.encounter_id=v_encounter.id and cb.is_active and not cb.turn_blocked
  order by cb.turn_order,cb.id
  offset v_encounter.turn_index limit 1;

  select * into v_combatant
  from public.combatants
  where id=p_combatant_id
  for update;

  update public.combatants
  set turn_blocked=coalesce(p_turn_blocked,false),
      is_active=coalesce(p_is_active,true),
      updated_at=now()
  where id=p_combatant_id;

  select count(*) into v_count
  from public.combatants
  where encounter_id=v_encounter.id and is_active and not turn_blocked;

  if v_count=0 then
    update public.combat_encounters set turn_index=0,updated_at=now() where id=v_encounter.id;
    return jsonb_build_object('ok',true,'message','Todos os turnos estão bloqueados.');
  end if;

  if v_current_id is not null and exists (
    select 1 from public.combatants
    where id=v_current_id and encounter_id=v_encounter.id and is_active and not turn_blocked
  ) then
    select position-1 into v_next_index
    from (
      select id,row_number() over(order by turn_order,id) as position
      from public.combatants
      where encounter_id=v_encounter.id and is_active and not turn_blocked
    ) ordered
    where id=v_current_id;
    update public.combat_encounters set turn_index=v_next_index,updated_at=now() where id=v_encounter.id;
    return jsonb_build_object('ok',true,'message','Disponibilidade do combatente atualizada.');
  end if;

  if v_current_id = p_combatant_id and v_encounter.turn_index >= v_count then
    v_next_index := 0;
    v_advance_round := true;
  else
    v_next_index := least(v_encounter.turn_index,v_count-1);
  end if;

  select character_id into v_next_id
  from (
    select character_id,row_number() over(order by turn_order,combatants.id)-1 as position
    from public.combatants
    where encounter_id=v_encounter.id and is_active and not turn_blocked
  ) ordered
  where position=v_next_index;

  update public.combat_encounters set turn_index=v_next_index,updated_at=now() where id=v_encounter.id;
  if v_next_id is not null then
    perform public.advance_combat_turn(v_encounter.id,v_next_id,v_advance_round,false);
  end if;

  return jsonb_build_object('ok',true,'message','Disponibilidade atualizada e próximo turno definido.');
end;
$$;

revoke all on function public.set_combatant_turn_state(uuid,boolean,boolean) from public,anon;
grant execute on function public.set_combatant_turn_state(uuid,boolean,boolean) to authenticated;
