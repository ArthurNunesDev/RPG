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
  v_current_id uuid;
  v_new_index integer;
begin
  if p_first_combatant_id = p_second_combatant_id then raise exception 'Selecione dois combatentes diferentes.'; end if;
  select * into v_encounter from public.combat_encounters where id=p_encounter_id for update;
  if not found or v_encounter.status <> 'active' then raise exception 'Combate não está ativo.'; end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then raise exception 'Apenas o mestre pode reorganizar a iniciativa.'; end if;

  select cb.id into v_current_id
  from public.combatants cb
  where cb.encounter_id=p_encounter_id and cb.is_active and not cb.turn_blocked
  order by cb.turn_order,cb.id
  offset v_encounter.turn_index limit 1;

  select * into v_first from public.combatants where id=p_first_combatant_id and encounter_id=p_encounter_id for update;
  if not found then raise exception 'Primeiro combatente não pertence a este combate.'; end if;
  select * into v_second from public.combatants where id=p_second_combatant_id and encounter_id=p_encounter_id for update;
  if not found then raise exception 'Segundo combatente não pertence a este combate.'; end if;

  update public.combatants
  set turn_order=case when id=v_first.id then v_second.turn_order when id=v_second.id then v_first.turn_order end,
      updated_at=now()
  where id in (v_first.id,v_second.id);

  if v_current_id is not null then
    select position-1 into v_new_index
    from (
      select id,row_number() over(order by turn_order,id) as position
      from public.combatants
      where encounter_id=p_encounter_id and is_active and not turn_blocked
    ) ordered
    where id=v_current_id;

    if v_new_index is not null then
      update public.combat_encounters set turn_index=v_new_index,updated_at=now() where id=p_encounter_id;
    end if;
  end if;
end;
$$;

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

  v_next_index := least(v_encounter.turn_index,v_count-1);
  select id into v_next_id
  from (
    select character_id as id,row_number() over(order by turn_order,combatants.id)-1 as position
    from public.combatants
    where encounter_id=v_encounter.id and is_active and not turn_blocked
  ) ordered
  where position=v_next_index;

  update public.combat_encounters set turn_index=v_next_index,updated_at=now() where id=v_encounter.id;
  if v_next_id is not null then
    perform public.advance_combat_turn(v_encounter.id,v_next_id,false,false);
  end if;

  return jsonb_build_object('ok',true,'message','Disponibilidade atualizada e próximo turno definido.');
end;
$$;

revoke all on function public.swap_combatant_turn_order(uuid,uuid,uuid) from public,anon;
revoke all on function public.set_combatant_turn_state(uuid,boolean,boolean) from public,anon;
grant execute on function public.swap_combatant_turn_order(uuid,uuid,uuid) to authenticated;
grant execute on function public.set_combatant_turn_state(uuid,boolean,boolean) to authenticated;
