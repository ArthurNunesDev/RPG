create or replace function public.resolve_combat_action(p_request_id uuid, p_resolution jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_request public.combat_action_requests%rowtype;
  v_encounter public.combat_encounters%rowtype;
  v_actor public.combatants%rowtype;
  v_target public.combatants%rowtype;
  v_damage integer := greatest(0, coalesce((p_resolution->>'damage')::integer, 0));
  v_healing integer := greatest(0, coalesce((p_resolution->>'healing')::integer, 0));
  v_pe_cost integer := greatest(0, coalesce((p_resolution->>'pe_cost')::integer, 0));
  v_new_hp integer;
  v_new_pe integer;
  v_event_type text;
  v_message text;
  v_condition text := nullif(trim(p_resolution->>'condition'),'');
  v_action_cost text;
  v_action_key text;
begin
  if p_resolution is null or jsonb_typeof(p_resolution) <> 'object' then raise exception 'Resolução inválida.'; end if;
  select * into v_request from public.combat_action_requests where id=p_request_id for update;
  if not found then raise exception 'Solicitação não encontrada.'; end if;
  select * into v_encounter from public.combat_encounters where id=v_request.encounter_id for update;
  if not found or v_encounter.status<>'active' then raise exception 'Combate não está ativo.'; end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then raise exception 'Apenas o mestre pode resolver ações.'; end if;
  if v_request.status<>'pending' then raise exception 'Esta ação já foi processada.'; end if;
  select * into v_actor from public.combatants where encounter_id=v_request.encounter_id and character_id=v_request.actor_character_id for update;
  if not found then raise exception 'Combatente não encontrado.'; end if;
  if v_request.target_character_id is not null then
    select * into v_target from public.combatants where encounter_id=v_request.encounter_id and character_id=v_request.target_character_id for update;
    if not found then raise exception 'Alvo não encontrado neste combate.'; end if;
  end if;
  if v_pe_cost>v_actor.current_pe then raise exception 'PE insuficientes.'; end if;
  v_action_cost := lower(coalesce(v_request.payload->'action'->>'actionCost','padrão'));
  v_action_key := case when v_action_cost in ('padrão','padrao','standard') then 'standard'
    when v_action_cost in ('movimento','movement') then 'movement'
    when v_action_cost in ('reação','reacao','reaction') then 'reaction' else null end;
  if v_action_key is not null and coalesce((v_actor.actions_used->>v_action_key)::boolean,false) then raise exception 'Este tipo de ação já foi utilizado neste turno.'; end if;
  if v_request.action_type in ('attack','ability','counterattack') and v_target.id is not null and v_damage>0 then
    v_new_hp:=greatest(0,v_target.current_hp-v_damage);
    update public.combatants set current_hp=v_new_hp,updated_at=now() where id=v_target.id;
    update public.characters set sheet=jsonb_set(coalesce(sheet,'{}'::jsonb),'{vitals,hp}',to_jsonb(v_new_hp),true),updated_at=now() where id=v_target.character_id;
  end if;
  if v_healing>0 then
    if v_target.id is null then raise exception 'Selecione um alvo para aplicar a cura.'; end if;
    v_new_hp:=least(v_target.max_hp,v_target.current_hp+v_healing);
    update public.combatants set current_hp=v_new_hp,updated_at=now() where id=v_target.id;
    update public.characters set sheet=jsonb_set(coalesce(sheet,'{}'::jsonb),'{vitals,hp}',to_jsonb(v_new_hp),true),updated_at=now() where id=v_target.character_id;
  end if;
  if v_condition is not null then
    if v_target.id is null then raise exception 'Selecione um alvo para aplicar a condição.'; end if;
    update public.combatants set conditions=array(select distinct unnest(array_append(conditions,v_condition))),updated_at=now() where id=v_target.id;
  end if;
  v_new_pe:=v_actor.current_pe-v_pe_cost;
  update public.combatants set current_pe=v_new_pe,
    actions_used=case when v_action_key is null then actions_used else jsonb_set(actions_used,array[v_action_key],'true'::jsonb,true) end,
    updated_at=now() where id=v_actor.id;
  if v_pe_cost>0 then update public.characters set sheet=jsonb_set(coalesce(sheet,'{}'::jsonb),'{vitals,pe}',to_jsonb(v_new_pe),true),updated_at=now() where id=v_actor.character_id; end if;
  v_event_type:=case when v_request.action_type in ('dodge','counterattack','defend') then 'reaction' when v_condition is not null then 'condition' when v_healing>0 then 'healing' when v_damage>0 then 'damage' when v_request.action_type='attack' then 'attack' else 'ability' end;
  v_message:=coalesce(p_resolution->>'message',v_actor.character_name||' executou '||v_request.action_type||case when v_target.id is not null then ' contra '||v_target.character_name else '' end||'.');
  insert into public.combat_events(encounter_id,actor_character_id,target_character_id,actor_name,target_name,event_type,result,created_by)
  values(v_request.encounter_id,v_actor.character_id,v_target.character_id,v_actor.character_name,v_target.character_name,v_event_type,
    jsonb_build_object('message',v_message,'damage',v_damage,'healing',v_healing,'condition',v_condition,'pe_cost',v_pe_cost,'action_cost',v_action_cost,'resolution',p_resolution),(select auth.uid()));
  update public.combat_action_requests set status='resolved',resolved_by=(select auth.uid()),resolved_at=now() where id=p_request_id;
  return jsonb_build_object('ok',true,'message',v_message,'damage',v_damage,'healing',v_healing,'condition',v_condition,'pe',v_new_pe);
end;
$function$;
revoke all on function public.resolve_combat_action(uuid,jsonb) from public,anon;
grant execute on function public.resolve_combat_action(uuid,jsonb) to authenticated;