-- Roll combat actions on the database using the approved combatant sheet snapshot.
-- Client-provided roll totals are no longer trusted.

create or replace function private.roll_dice_formula(p_formula text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_parts text[];
  v_count integer;
  v_sides integer;
  v_modifier integer := 0;
  v_roll integer;
  v_total integer := 0;
  v_rolls jsonb := '[]'::jsonb;
  v_minimum boolean := true;
  v_maximum boolean := true;
  v_natural_min integer := 1000000;
  v_natural_max integer := 0;
  i integer;
begin
  if p_formula is null then raise exception 'Fórmula de dados ausente.'; end if;
  v_parts := regexp_match(
    lower(btrim(p_formula)),
    '^([0-9]{1,3})d([0-9]{1,4})([[:space:]]*([+-])[[:space:]]*([0-9]{1,5}))?$'
  );
  if v_parts is null then
    raise exception 'Fórmula de dados inválida: %.', p_formula;
  end if;

  v_count := v_parts[1]::integer;
  v_sides := v_parts[2]::integer;
  if v_parts[5] is not null then
    v_modifier := v_parts[5]::integer * case when v_parts[4] = '-' then -1 else 1 end;
  end if;
  if v_count < 1 or v_count > 100 or v_sides < 2 or v_sides > 1000 then
    raise exception 'Fórmula de dados excede os limites permitidos.';
  end if;

  for i in 1..v_count loop
    v_roll := floor(random() * v_sides)::integer + 1;
    v_rolls := v_rolls || to_jsonb(v_roll);
    v_total := v_total + v_roll;
    v_minimum := v_minimum and v_roll = 1;
    v_maximum := v_maximum and v_roll = v_sides;
    v_natural_min := least(v_natural_min, v_roll);
    v_natural_max := greatest(v_natural_max, v_roll);
  end loop;

  v_total := v_total + v_modifier;
  return jsonb_build_object(
    'formula', btrim(p_formula),
    'rolls', v_rolls,
    'modifier', v_modifier,
    'total', v_total,
    'minimum', v_minimum,
    'maximum', v_maximum,
    'naturalMinimum', v_natural_min,
    'naturalMaximum', v_natural_max
  );
end;
$$;

revoke all on function private.roll_dice_formula(text) from public, anon;
grant execute on function private.roll_dice_formula(text) to authenticated;

create or replace function public.resolve_combat_action(p_request_id uuid, p_resolution jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_request public.combat_action_requests%rowtype;
  v_encounter public.combat_encounters%rowtype;
  v_actor public.combatants%rowtype;
  v_target public.combatants%rowtype;
  v_sheet jsonb;
  v_actions jsonb;
  v_action jsonb;
  v_action_item jsonb;
  v_action_name text;
  v_effect_type text;
  v_test_formula text;
  v_damage_formula text;
  v_critical_formula text;
  v_healing_formula text;
  v_skill_name text;
  v_action_cost text;
  v_action_key text;
  v_pe_cost integer;
  v_skill_bonus integer := 0;
  v_defense integer;
  v_test_roll jsonb;
  v_attack_roll jsonb;
  v_damage_roll jsonb := 'null'::jsonb;
  v_critical_roll jsonb := 'null'::jsonb;
  v_healing_roll jsonb := 'null'::jsonb;
  v_total_attack integer := 0;
  v_damage integer := 0;
  v_healing integer := 0;
  v_new_hp integer;
  v_new_pe integer;
  v_outcome text;
  v_condition text;
  v_message text;
  v_event_type text;
  v_result jsonb;
  v_legacy_line text;
begin
  select * into v_request
  from public.combat_action_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Solicitação não encontrada.'; end if;

  select * into v_encounter
  from public.combat_encounters
  where id = v_request.encounter_id
  for update;
  if not found or v_encounter.status <> 'active' then raise exception 'Combate não está ativo.'; end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then raise exception 'Apenas o mestre pode resolver ações.'; end if;
  if not (select private.is_realm_session_for_campaign(v_encounter.session_id, v_encounter.campaign_id)) then raise exception 'A sessão não pertence à campanha deste combate.'; end if;
  if v_request.status <> 'pending' then raise exception 'Esta ação já foi processada.'; end if;

  select * into v_actor
  from public.combatants
  where encounter_id = v_request.encounter_id
    and character_id = v_request.actor_character_id
  for update;
  if not found then raise exception 'Combatente não encontrado.'; end if;

  if v_request.target_character_id is not null then
    select * into v_target
    from public.combatants
    where encounter_id = v_request.encounter_id
      and character_id = v_request.target_character_id
    for update;
    if not found then raise exception 'Alvo não encontrado neste combate.'; end if;
  end if;

  select sheet_snapshot into v_sheet
  from public.combatant_sheets
  where combatant_id = v_actor.id;
  if v_sheet is null then raise exception 'Ficha de combate não encontrada.'; end if;

  v_actions := case
    when v_request.action_type = 'attack' then v_sheet->'attacks'
    else v_sheet->'abilities'
  end;

  if jsonb_typeof(v_actions) = 'array' then
    select item into v_action
    from jsonb_array_elements(v_actions) as entries(item)
    where item->>'id' = v_request.action_id
       or item->>'name' = v_request.action_id
       or (jsonb_typeof(item) = 'string' and item #>> '{}' = v_request.action_id)
    limit 1;

    if v_action is not null and jsonb_typeof(v_action) = 'string' then
      v_legacy_line := v_action #>> '{}';
      v_action := jsonb_build_object(
        'id', v_request.action_id,
        'name', v_legacy_line,
        'testFormula', '1d20',
        'damageFormula', case when v_request.action_type = 'attack' then '2d10' else '' end,
        'effectType', case when v_request.action_type = 'attack' then 'damage' else 'utility' end,
        'skill', 'Luta',
        'actionCost', 'padrão',
        'peCost', 0
      );
    end if;
  elsif jsonb_typeof(v_actions) = 'string' then
    select btrim(line) into v_legacy_line
    from regexp_split_to_table(v_actions #>> '{}', E'\\n') as lines(line)
    where btrim(line) = v_request.action_id
    limit 1;

    if v_legacy_line is not null then
      v_action := jsonb_build_object(
        'id', v_request.action_id,
        'name', v_legacy_line,
        'testFormula', '1d20',
        'damageFormula', case when v_request.action_type = 'attack' then '2d10' else '' end,
        'effectType', case when v_request.action_type = 'attack' then 'damage' else 'utility' end,
        'skill', 'Luta',
        'actionCost', 'padrão',
        'peCost', 0
      );
    end if;
  end if;

  if v_action is null then
    raise exception 'Ação não encontrada na ficha salva do combatente.';
  end if;

  v_action_name := coalesce(nullif(btrim(v_action->>'name'), ''), v_request.action_id);
  v_effect_type := coalesce(nullif(lower(btrim(v_action->>'effectType')), ''), case when v_request.action_type = 'attack' then 'damage' else 'utility' end);
  v_test_formula := coalesce(nullif(btrim(v_action->>'testFormula'), ''), '1d20');
  v_damage_formula := nullif(btrim(v_action->>'damageFormula'), '');
  v_critical_formula := nullif(btrim(v_action->>'criticalExtraFormula'), '');
  v_healing_formula := nullif(btrim(v_action->>'healingFormula'), '');
  v_skill_name := coalesce(nullif(btrim(v_action->>'skill'), ''), 'Luta');
  v_action_cost := lower(coalesce(nullif(btrim(v_action->>'actionCost'), ''), 'padrão'));
  v_pe_cost := greatest(0, coalesce(nullif(v_action->>'peCost', '')::integer, 0));
  v_condition := nullif(btrim(v_action->>'statusEffect'), '');

  if v_request.action_type in ('dodge','counterattack','defend') then
    if coalesce(v_action->>'actionType','') <> v_request.action_type then
      raise exception 'A reação solicitada não corresponde à ficha salva.';
    end if;
    v_action_cost := 'reação';
  elsif v_request.action_type = 'attack' and v_effect_type <> 'damage' then
    raise exception 'O ataque salvo possui um tipo de efeito inválido.';
  elsif v_request.action_type = 'ability' and coalesce(v_action->>'actionType','ability') in ('dodge','counterattack','defend') then
    raise exception 'Esta habilidade deve ser enviada como reação.';
  end if;

  if v_effect_type in ('damage','healing') and v_target.id is null then
    raise exception 'Selecione um alvo para esta ação.';
  end if;
  if v_condition is not null and v_target.id is null then
    raise exception 'Selecione um alvo para aplicar a condição.';
  end if;

  if v_effect_type = 'healing' then
    if v_healing_formula is not null then
      v_healing_roll := private.roll_dice_formula(v_healing_formula);
      v_healing := greatest(0, (v_healing_roll->>'total')::integer);
    end if;
    v_outcome := 'healing';
    v_message := format('%s: cura de %s PV.', v_action_name, v_healing);
  elsif v_effect_type = 'utility' then
    v_test_roll := private.roll_dice_formula(v_test_formula);
    v_outcome := 'utility';
    v_message := format('%s: resultado %s.', v_action_name, v_test_roll->>'total');
  else
    if v_target.id is null then raise exception 'Selecione um alvo para esta ação.'; end if;

    v_test_roll := private.roll_dice_formula(v_test_formula);
    v_skill_bonus := coalesce((v_sheet->'skills'->v_skill_name->>'training')::integer, 0)
      + coalesce((v_sheet->'skills'->v_skill_name->>'bonus')::integer, 0)
      + coalesce((v_sheet->'skills'->v_skill_name->>'other')::integer, 0);
    v_total_attack := (v_test_roll->>'total')::integer + v_skill_bonus;
    v_attack_roll := v_test_roll || jsonb_build_object('total', v_total_attack, 'bonus', v_skill_bonus);
    v_defense := coalesce(v_target.defense, 10);

    if coalesce((v_test_roll->>'minimum')::boolean, false) then
      v_outcome := 'disaster';
      v_message := 'Desastre: resultado mínimo no dado. O mestre define a consequência.';
    elsif v_total_attack < v_defense then
      v_outcome := 'miss';
      v_message := 'Ataque não superou a defesa do alvo.';
    else
      if v_damage_formula is not null then
        v_damage_roll := private.roll_dice_formula(v_damage_formula);
        v_damage := greatest(0, (v_damage_roll->>'total')::integer);
      end if;
      if coalesce((v_damage_roll->>'maximum')::boolean, false) then
        v_outcome := 'critical';
        if v_critical_formula is not null then
          v_critical_roll := private.roll_dice_formula(v_critical_formula);
          v_damage := v_damage + greatest(0, (v_critical_roll->>'total')::integer);
        end if;
        v_message := 'Acerto crítico: dano máximo no dado.';
      else
        v_outcome := 'hit';
        v_message := case when v_request.action_type = 'attack' then 'Ataque acertou.' else 'Habilidade acertou.' end;
      end if;
    end if;
  end if;

  if v_outcome not in ('hit','critical','utility') then
    v_condition := null;
  end if;

  if v_pe_cost > v_actor.current_pe then raise exception 'PE insuficientes.'; end if;

  v_action_key := case
    when v_action_cost in ('padrão','padrao','standard') then 'standard'
    when v_action_cost in ('movimento','movement') then 'movement'
    when v_action_cost in ('reação','reacao','reaction') then 'reaction'
    else null
  end;
  if v_action_key is not null and coalesce((v_actor.actions_used->>v_action_key)::boolean, false) then
    raise exception 'Este tipo de ação já foi utilizado neste turno.';
  end if;

  if v_target.id is not null and (v_damage > 0 or v_healing > 0) then
    v_new_hp := greatest(0, least(v_target.max_hp, v_target.current_hp - v_damage + v_healing));
    update public.combatants
    set current_hp = v_new_hp, updated_at = now()
    where id = v_target.id;

    update public.characters
    set sheet = jsonb_set(
          coalesce(sheet, '{}'::jsonb),
          '{vitals}',
          coalesce(sheet->'vitals', '{}'::jsonb) || jsonb_build_object('hp', v_new_hp),
          true
        ),
        updated_at = now()
    where id = v_target.character_id;

    update public.combatant_sheets
    set sheet_snapshot = jsonb_set(
          coalesce(sheet_snapshot, '{}'::jsonb),
          '{vitals}',
          coalesce(sheet_snapshot->'vitals', '{}'::jsonb) || jsonb_build_object('hp', v_new_hp),
          true
        ),
        updated_at = now()
    where combatant_id = v_target.id;
  end if;

  if v_condition is not null then
    update public.combatants
    set conditions = array(select distinct unnest(array_append(conditions, v_condition))),
        updated_at = now()
    where id = v_target.id;
  end if;

  v_new_pe := v_actor.current_pe - v_pe_cost;
  update public.combatants
  set current_pe = v_new_pe,
      actions_used = case
        when v_action_key is null then actions_used
        else jsonb_set(actions_used, array[v_action_key], 'true'::jsonb, true)
      end,
      updated_at = now()
  where id = v_actor.id;

  if v_pe_cost > 0 then
    update public.characters
    set sheet = jsonb_set(
          coalesce(sheet, '{}'::jsonb),
          '{vitals}',
          coalesce(sheet->'vitals', '{}'::jsonb) || jsonb_build_object('pe', v_new_pe),
          true
        ),
        updated_at = now()
    where id = v_actor.character_id;

    update public.combatant_sheets
    set sheet_snapshot = jsonb_set(
          coalesce(sheet_snapshot, '{}'::jsonb),
          '{vitals}',
          coalesce(sheet_snapshot->'vitals', '{}'::jsonb) || jsonb_build_object('pe', v_new_pe),
          true
        ),
        updated_at = now()
    where combatant_id = v_actor.id;
  end if;

  v_event_type := case
    when v_request.action_type in ('dodge','counterattack','defend') then 'reaction'
    when v_condition is not null then 'condition'
    when v_healing > 0 then 'healing'
    when v_damage > 0 then 'damage'
    when v_request.action_type = 'attack' then 'attack'
    else 'ability'
  end;

  v_result := jsonb_build_object(
    'outcome', v_outcome,
    'attackRoll', v_attack_roll,
    'testRoll', v_test_roll,
    'defense', v_defense,
    'damage', v_damage_roll,
    'criticalExtra', v_critical_roll,
    'healingRoll', v_healing_roll,
    'totalDamage', v_damage,
    'totalHealing', v_healing,
    'condition', v_condition,
    'peCost', v_pe_cost,
    'actionCost', v_action_cost
  );
  v_result := v_result || jsonb_build_object('message', v_message);

  insert into public.combat_events (
    encounter_id, actor_character_id, target_character_id, actor_name, target_name,
    event_type, result, created_by
  )
  values (
    v_request.encounter_id, v_actor.character_id, v_target.character_id,
    v_actor.character_name, v_target.character_name, v_event_type,
    v_result, (select auth.uid())
  );

  update public.combat_action_requests
  set status = 'resolved',
      resolved_by = (select auth.uid()),
      resolved_at = now(),
      payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{server_result}', v_result, true)
  where id = p_request_id;

  return jsonb_build_object(
    'ok', true,
    'message', v_message,
    'result', v_result,
    'damage', v_damage,
    'healing', v_healing,
    'condition', v_condition,
    'pe', v_new_pe
  );
end;
$function$;

revoke all on function public.resolve_combat_action(uuid,jsonb) from public, anon;
grant execute on function public.resolve_combat_action(uuid,jsonb) to authenticated;
