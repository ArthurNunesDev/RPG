-- Phase 2: make periodic effects turn-based and combat mutations atomic.

alter table public.combat_encounters
  add column if not exists turn_sequence bigint not null default 1
  check (turn_sequence >= 1);

alter table public.combat_effects
  add column if not exists applied_turn_sequence bigint not null default 0
  check (applied_turn_sequence >= 0);

update public.combat_effects fx
set applied_turn_sequence = e.turn_sequence
from public.combat_encounters e
where e.id = fx.encounter_id
  and fx.applied_turn_sequence = 0;

alter table public.combat_effects
  drop constraint if exists combat_effects_remaining_rounds_check;
alter table public.combat_effects
  add constraint combat_effects_remaining_rounds_check
  check (remaining_rounds >= 0);

grant update (turn_sequence) on public.combat_encounters to authenticated;
grant update (applied_turn_sequence) on public.combat_effects to authenticated;

create or replace function public.apply_combat_effect(
  p_encounter_id uuid,
  p_target_character_id uuid,
  p_effect_name text,
  p_duration integer,
  p_damage integer,
  p_duplicate_mode text default 'refresh',
  p_source_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_encounter public.combat_encounters%rowtype;
  v_target public.combatants%rowtype;
  v_effect public.combat_effects%rowtype;
  v_effect_id uuid;
  v_message text;
begin
  if p_effect_name is null or char_length(btrim(p_effect_name)) not between 1 and 80 then
    raise exception 'Nome do efeito inválido.';
  end if;
  if p_duration is null or p_duration not between 1 and 100 then
    raise exception 'A duração deve ficar entre 1 e 100 turnos.';
  end if;
  if p_damage is null or p_damage < 0 or p_damage > 100000 then
    raise exception 'Dano periódico inválido.';
  end if;
  if p_duplicate_mode not in ('refresh','replace','stack') then
    raise exception 'Modo de duplicidade inválido.';
  end if;

  select * into v_encounter
  from public.combat_encounters
  where id = p_encounter_id
  for update;

  if not found or v_encounter.status <> 'active' then
    raise exception 'Combate não está ativo.';
  end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then
    raise exception 'Apenas o mestre pode administrar efeitos.';
  end if;
  if not (select private.is_realm_session_for_campaign(v_encounter.session_id, v_encounter.campaign_id)) then
    raise exception 'A sessão não pertence à campanha deste combate.';
  end if;

  select * into v_target
  from public.combatants
  where encounter_id = p_encounter_id
    and character_id = p_target_character_id
  for update;

  if not found then
    raise exception 'O alvo não pertence a este combate.';
  end if;

  if p_duplicate_mode in ('refresh','replace') then
    if p_duplicate_mode = 'replace' then
      update public.combat_effects
      set remaining_rounds = 0, updated_at = now()
      where encounter_id = p_encounter_id
        and target_character_id = p_target_character_id
        and lower(effect_name) = lower(btrim(p_effect_name))
        and remaining_rounds > 0;
    else
      select * into v_effect
      from public.combat_effects
      where encounter_id = p_encounter_id
        and target_character_id = p_target_character_id
        and lower(effect_name) = lower(btrim(p_effect_name))
        and remaining_rounds > 0
      order by created_at desc
      limit 1
      for update;

      if found then
        update public.combat_effects
        set remaining_rounds = 0, updated_at = now()
        where encounter_id = p_encounter_id
          and target_character_id = p_target_character_id
          and lower(effect_name) = lower(btrim(p_effect_name))
          and remaining_rounds > 0
          and id <> v_effect.id;

        update public.combat_effects
        set target_name = v_target.character_name,
            effect_name = btrim(p_effect_name),
            effect_type = 'damage',
            damage_per_round = p_damage,
            healing_per_round = 0,
            remaining_rounds = p_duration,
            source_name = nullif(btrim(coalesce(p_source_name, '')), ''),
            applied_turn_sequence = v_encounter.turn_sequence,
            updated_at = now()
        where id = v_effect.id
        returning id into v_effect_id;
      end if;
    end if;
  end if;

  if v_effect_id is null then
    insert into public.combat_effects (
      encounter_id, target_character_id, target_name, effect_name, effect_type,
      damage_per_round, healing_per_round, remaining_rounds, source_name,
      applied_round, applied_turn_sequence, created_by
    )
    values (
      p_encounter_id, p_target_character_id, v_target.character_name, btrim(p_effect_name), 'damage',
      p_damage, 0, p_duration, nullif(btrim(coalesce(p_source_name, '')), ''),
      v_encounter.round_number, v_encounter.turn_sequence, (select auth.uid())
    )
    returning id into v_effect_id;
  end if;

  v_message := format(
    '%s aplicado em %s: %s turno(s), %s de dano por turno.',
    btrim(p_effect_name), v_target.character_name, p_duration, p_damage
  );

  insert into public.combat_events (
    encounter_id, actor_character_id, target_character_id, actor_name, target_name,
    event_type, result, created_by
  )
  values (
    p_encounter_id, null, p_target_character_id, coalesce(nullif(btrim(p_source_name), ''), 'Mestre'),
    v_target.character_name, 'condition',
    jsonb_build_object(
      'message', v_message,
      'effect_id', v_effect_id,
      'duration', p_duration,
      'damage_per_round', p_damage,
      'duplicate_mode', p_duplicate_mode
    ),
    (select auth.uid())
  );

  return jsonb_build_object('ok', true, 'effect_id', v_effect_id, 'message', v_message);
end;
$$;

create or replace function public.update_combat_effect(
  p_effect_id uuid,
  p_effect_name text,
  p_damage integer,
  p_remaining_rounds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_effect public.combat_effects%rowtype;
  v_encounter public.combat_encounters%rowtype;
  v_target public.combatants%rowtype;
  v_message text;
begin
  if p_effect_name is null or char_length(btrim(p_effect_name)) not between 1 and 80 then
    raise exception 'Nome do efeito inválido.';
  end if;
  if p_damage is null or p_damage < 0 or p_damage > 100000 then
    raise exception 'Dano periódico inválido.';
  end if;
  if p_remaining_rounds is null or p_remaining_rounds not between 0 and 100 then
    raise exception 'A duração deve ficar entre 0 e 100 turnos.';
  end if;

  select * into v_effect
  from public.combat_effects
  where id = p_effect_id
  for update;
  if not found then raise exception 'Efeito não encontrado.'; end if;

  select * into v_encounter
  from public.combat_encounters
  where id = v_effect.encounter_id
  for update;
  if not found or v_encounter.status <> 'active' then raise exception 'Combate não está ativo.'; end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then
    raise exception 'Apenas o mestre pode editar efeitos.';
  end if;

  select * into v_target
  from public.combatants
  where encounter_id = v_effect.encounter_id
    and character_id = v_effect.target_character_id
  for update;
  if not found then raise exception 'Alvo não pertence mais a este combate.'; end if;

  update public.combat_effects
  set effect_name = btrim(p_effect_name),
      target_name = v_target.character_name,
      damage_per_round = p_damage,
      remaining_rounds = p_remaining_rounds,
      applied_turn_sequence = case
        when p_remaining_rounds > 0 then v_encounter.turn_sequence
        else applied_turn_sequence
      end,
      updated_at = now()
  where id = p_effect_id;

  v_message := case
    when p_remaining_rounds = 0 then format('%s encerrado em %s.', btrim(p_effect_name), v_target.character_name)
    else format('%s atualizado em %s: %s turno(s), %s de dano por turno.', btrim(p_effect_name), v_target.character_name, p_remaining_rounds, p_damage)
  end;

  insert into public.combat_events (
    encounter_id, actor_character_id, target_character_id, actor_name, target_name,
    event_type, result, created_by
  )
  values (
    v_effect.encounter_id, null, v_effect.target_character_id, 'Mestre', v_target.character_name,
    'condition',
    jsonb_build_object('message', v_message, 'effect_id', p_effect_id, 'remaining_rounds', p_remaining_rounds, 'damage_per_round', p_damage),
    (select auth.uid())
  );

  return jsonb_build_object('ok', true, 'message', v_message);
end;
$$;

create or replace function public.advance_combat_turn(
  p_encounter_id uuid,
  p_target_character_id uuid default null,
  p_advance_round boolean default true,
  p_skip boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_encounter public.combat_encounters%rowtype;
  v_next public.combatants%rowtype;
  v_effect public.combat_effects%rowtype;
  v_count integer;
  v_current_index integer;
  v_next_index integer;
  v_next_round integer;
  v_next_sequence bigint;
  v_new_hp integer;
  v_effect_message text;
  v_turn_message text;
begin
  select * into v_encounter
  from public.combat_encounters
  where id = p_encounter_id
  for update;

  if not found or v_encounter.status <> 'active' then
    raise exception 'Combate não está ativo.';
  end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then
    raise exception 'Apenas o mestre pode avançar turnos.';
  end if;
  if not (select private.is_realm_session_for_campaign(v_encounter.session_id, v_encounter.campaign_id)) then
    raise exception 'A sessão não pertence à campanha deste combate.';
  end if;

  select count(*) into v_count
  from public.combatants
  where encounter_id = p_encounter_id
    and is_active
    and not turn_blocked;

  if v_count = 0 then raise exception 'Não há combatentes com turno liberado.'; end if;

  v_current_index := greatest(0, least(v_encounter.turn_index, v_count - 1));

  if p_target_character_id is null then
    v_next_index := (v_current_index + 1) % v_count;
  else
    select eligible.position - 1 into v_next_index
    from (
      select id, character_id, row_number() over (order by turn_order, id) as position
      from public.combatants
      where encounter_id = p_encounter_id
        and is_active
        and not turn_blocked
    ) eligible
    where eligible.character_id = p_target_character_id;

    if not found then raise exception 'O combatente escolhido não possui turno liberado.'; end if;
  end if;

  select cb.* into v_next
  from (
    select id, row_number() over (order by turn_order, id) - 1 as position
    from public.combatants
    where encounter_id = p_encounter_id
      and is_active
      and not turn_blocked
  ) eligible
  join public.combatants cb on cb.id = eligible.id
  where eligible.position = v_next_index;

  if not found then raise exception 'Não foi possível localizar o próximo combatente.'; end if;

  v_next_round := v_encounter.round_number;
  if p_advance_round and v_next_index <= v_current_index then
    v_next_round := v_encounter.round_number + 1;
  end if;
  v_next_sequence := v_encounter.turn_sequence + 1;

  update public.combat_encounters
  set turn_index = v_next_index,
      round_number = v_next_round,
      turn_sequence = v_next_sequence,
      current_turn_note = '',
      updated_at = now()
  where id = p_encounter_id;

  if v_next_round > v_encounter.round_number then
    update public.combatants
    set actions_used = '{"standard":false,"movement":false,"reaction":false}'::jsonb,
        updated_at = now()
    where encounter_id = p_encounter_id
      and is_active;
  end if;

  for v_effect in
    select *
    from public.combat_effects
    where encounter_id = p_encounter_id
      and target_character_id = v_next.character_id
      and remaining_rounds > 0
      and applied_turn_sequence < v_next_sequence
    order by created_at, id
    for update
  loop
    v_new_hp := null;

    if v_effect.damage_per_round > 0 then
      update public.combatants
      set current_hp = greatest(0, current_hp - v_effect.damage_per_round),
          updated_at = now()
      where id = v_next.id
      returning current_hp into v_new_hp;
    elsif v_effect.healing_per_round > 0 then
      update public.combatants
      set current_hp = least(max_hp, current_hp + v_effect.healing_per_round),
          updated_at = now()
      where id = v_next.id
      returning current_hp into v_new_hp;
    end if;

    if v_new_hp is not null then
      update public.characters
      set sheet = jsonb_set(
            coalesce(sheet, '{}'::jsonb),
            '{vitals}',
            coalesce(sheet->'vitals', '{}'::jsonb) || jsonb_build_object('hp', v_new_hp),
            true
          ),
          updated_at = now()
      where id = v_next.character_id;

      update public.combatant_sheets
      set sheet_snapshot = jsonb_set(
            coalesce(sheet_snapshot, '{}'::jsonb),
            '{vitals}',
            coalesce(sheet_snapshot->'vitals', '{}'::jsonb) || jsonb_build_object('hp', v_new_hp),
            true
          ),
          updated_at = now()
      where combatant_id = v_next.id;
    end if;

    update public.combat_effects
    set remaining_rounds = greatest(0, remaining_rounds - 1),
        applied_turn_sequence = v_next_sequence,
        updated_at = now()
    where id = v_effect.id;

    v_effect_message := case
      when v_effect.damage_per_round > 0 then format('%s: %s sofreu %s de dano periódico.', v_effect.effect_name, v_next.character_name, v_effect.damage_per_round)
      when v_effect.healing_per_round > 0 then format('%s: %s recuperou %s PV.', v_effect.effect_name, v_next.character_name, v_effect.healing_per_round)
      else format('%s: efeito aplicado em %s.', v_effect.effect_name, v_next.character_name)
    end;

    insert into public.combat_events (
      encounter_id, actor_character_id, target_character_id, actor_name, target_name,
      event_type, result, created_by
    )
    values (
      p_encounter_id, null, v_next.character_id, coalesce(v_effect.source_name, 'Efeito'),
      v_next.character_name,
      case when v_effect.damage_per_round > 0 then 'damage'
           when v_effect.healing_per_round > 0 then 'healing'
           else 'condition' end,
      jsonb_build_object(
        'message', v_effect_message,
        'effect_id', v_effect.id,
        'damage', v_effect.damage_per_round,
        'healing', v_effect.healing_per_round,
        'remaining_rounds', greatest(0, v_effect.remaining_rounds - 1)
      ),
      (select auth.uid())
    );
  end loop;

  v_turn_message := case
    when p_skip then format('Turno pulado. Vez de %s.', v_next.character_name)
    when v_next_round > v_encounter.round_number then format('Rodada %s iniciada. Vez de %s.', v_next_round, v_next.character_name)
    else format('Vez de %s.', v_next.character_name)
  end;

  insert into public.combat_events (
    encounter_id, actor_character_id, actor_name, event_type, result, created_by
  )
  values (
    p_encounter_id, v_next.character_id, v_next.character_name, 'turn',
    jsonb_build_object('message', v_turn_message, 'turn_sequence', v_next_sequence),
    (select auth.uid())
  );

  return jsonb_build_object(
    'ok', true,
    'message', v_turn_message,
    'round_number', v_next_round,
    'turn_index', v_next_index,
    'turn_sequence', v_next_sequence,
    'character_id', v_next.character_id
  );
end;
$$;

create or replace function public.apply_manual_combat_vitals(
  p_combatant_id uuid,
  p_damage integer default 0,
  p_healing integer default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_combatant public.combatants%rowtype;
  v_encounter public.combat_encounters%rowtype;
  v_new_hp integer;
  v_message text;
begin
  if coalesce(p_damage, 0) < 0 or coalesce(p_healing, 0) < 0 then
    raise exception 'Dano e cura não podem ser negativos.';
  end if;
  if coalesce(p_damage, 0) > 0 and coalesce(p_healing, 0) > 0 then
    raise exception 'Aplique dano ou cura em uma operação por vez.';
  end if;

  select e.* into v_encounter
  from public.combat_encounters e
  join public.combatants cb on cb.encounter_id = e.id
  where cb.id = p_combatant_id
  for update of e;

  if not found or v_encounter.status <> 'active' then
    raise exception 'Combatente não pertence a um combate ativo.';
  end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then
    raise exception 'Apenas o mestre pode alterar os pontos de vida.';
  end if;

  select * into v_combatant
  from public.combatants
  where id = p_combatant_id
  for update;

  v_new_hp := greatest(
    0,
    least(v_combatant.max_hp, v_combatant.current_hp - coalesce(p_damage, 0) + coalesce(p_healing, 0))
  );

  update public.combatants
  set current_hp = v_new_hp, updated_at = now()
  where id = p_combatant_id;

  update public.characters
  set sheet = jsonb_set(
        coalesce(sheet, '{}'::jsonb),
        '{vitals}',
        coalesce(sheet->'vitals', '{}'::jsonb) || jsonb_build_object('hp', v_new_hp),
        true
      ),
      updated_at = now()
  where id = v_combatant.character_id;

  update public.combatant_sheets
  set sheet_snapshot = jsonb_set(
        coalesce(sheet_snapshot, '{}'::jsonb),
        '{vitals}',
        coalesce(sheet_snapshot->'vitals', '{}'::jsonb) || jsonb_build_object('hp', v_new_hp),
        true
      ),
      updated_at = now()
  where combatant_id = p_combatant_id;

  v_message := case
    when coalesce(p_healing, 0) > 0 then format('Mestre recuperou %s PV de %s.', p_healing, v_combatant.character_name)
    else format('Mestre aplicou %s de dano em %s.', p_damage, v_combatant.character_name)
  end;

  insert into public.combat_events (
    encounter_id, actor_character_id, target_character_id, actor_name, target_name,
    event_type, result, created_by
  )
  values (
    v_combatant.encounter_id, null, v_combatant.character_id, 'Mestre', v_combatant.character_name,
    case when coalesce(p_healing, 0) > 0 then 'healing' else 'damage' end,
    jsonb_build_object('message', v_message, 'damage', coalesce(p_damage, 0), 'healing', coalesce(p_healing, 0), 'hp', v_new_hp),
    (select auth.uid())
  );

  return jsonb_build_object('ok', true, 'message', v_message, 'hp', v_new_hp);
end;
$$;

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
  v_damage integer := greatest(0, coalesce((p_resolution->>'damage')::integer, 0));
  v_healing integer := greatest(0, coalesce((p_resolution->>'healing')::integer, 0));
  v_pe_cost integer := greatest(0, coalesce((p_resolution->>'pe_cost')::integer, 0));
  v_new_hp integer;
  v_new_pe integer;
  v_event_type text;
  v_message text;
  v_outcome text := coalesce(p_resolution->>'outcome', '');
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
  if not (select private.is_realm_session_for_campaign(v_encounter.session_id, v_encounter.campaign_id)) then raise exception 'A sessão não pertence à campanha deste combate.'; end if;

  select * into v_actor from public.combatants where encounter_id=v_request.encounter_id and character_id=v_request.actor_character_id for update;
  if not found then raise exception 'Combatente não encontrado.'; end if;
  if v_request.target_character_id is not null then
    select * into v_target from public.combatants where encounter_id=v_request.encounter_id and character_id=v_request.target_character_id for update;
    if not found then raise exception 'Alvo não encontrado neste combate.'; end if;
  end if;

  if v_outcome not in ('hit','critical') then v_damage := 0; end if;
  if v_outcome <> 'healing' then v_healing := 0; end if;
  if v_outcome not in ('hit','critical','utility') then v_condition := null; end if;

  if v_pe_cost>v_actor.current_pe then raise exception 'PE insuficientes.'; end if;
  v_action_cost := lower(coalesce(v_request.payload->'action'->>'actionCost','padrão'));
  if v_request.action_type in ('dodge','counterattack','defend') then v_action_cost := 'reação'; end if;
  v_action_key := case when v_action_cost in ('padrão','padrao','standard') then 'standard'
    when v_action_cost in ('movimento','movement') then 'movement'
    when v_action_cost in ('reação','reacao','reaction') then 'reaction' else null end;
  if v_action_key is not null and coalesce((v_actor.actions_used->>v_action_key)::boolean,false) then raise exception 'Este tipo de ação já foi utilizado neste turno.'; end if;

  if v_target.id is not null and (v_damage > 0 or v_healing > 0) then
    v_new_hp := greatest(0, least(v_target.max_hp, v_target.current_hp - v_damage + v_healing));
    update public.combatants set current_hp=v_new_hp,updated_at=now() where id=v_target.id;

    update public.characters
    set sheet = jsonb_set(
          coalesce(sheet,'{}'::jsonb),
          '{vitals}',
          coalesce(sheet->'vitals','{}'::jsonb) || jsonb_build_object('hp',v_new_hp),
          true
        ),
        updated_at=now()
    where id=v_target.character_id;

    update public.combatant_sheets
    set sheet_snapshot = jsonb_set(
          coalesce(sheet_snapshot,'{}'::jsonb),
          '{vitals}',
          coalesce(sheet_snapshot->'vitals','{}'::jsonb) || jsonb_build_object('hp',v_new_hp),
          true
        ),
        updated_at=now()
    where combatant_id=v_target.id;
  end if;

  if v_condition is not null then
    if v_target.id is null then raise exception 'Selecione um alvo para aplicar a condição.'; end if;
    update public.combatants
    set conditions=array(select distinct unnest(array_append(conditions,v_condition))),updated_at=now()
    where id=v_target.id;
  end if;

  v_new_pe:=v_actor.current_pe-v_pe_cost;
  update public.combatants set current_pe=v_new_pe,
    actions_used=case when v_action_key is null then actions_used else jsonb_set(actions_used,array[v_action_key],'true'::jsonb,true) end,
    updated_at=now() where id=v_actor.id;

  if v_pe_cost>0 then
    update public.characters
    set sheet = jsonb_set(
          coalesce(sheet,'{}'::jsonb),
          '{vitals}',
          coalesce(sheet->'vitals','{}'::jsonb) || jsonb_build_object('pe',v_new_pe),
          true
        ),
        updated_at=now()
    where id=v_actor.character_id;

    update public.combatant_sheets
    set sheet_snapshot = jsonb_set(
          coalesce(sheet_snapshot,'{}'::jsonb),
          '{vitals}',
          coalesce(sheet_snapshot->'vitals','{}'::jsonb) || jsonb_build_object('pe',v_new_pe),
          true
        ),
        updated_at=now()
    where combatant_id=v_actor.id;
  end if;

  v_event_type:=case when v_request.action_type in ('dodge','counterattack','defend') then 'reaction' when v_condition is not null then 'condition' when v_healing>0 then 'healing' when v_damage>0 then 'damage' when v_request.action_type='attack' then 'attack' else 'ability' end;
  v_message:=coalesce(p_resolution->>'message',v_actor.character_name||' executou '||v_request.action_type||case when v_target.id is not null then ' contra '||v_target.character_name else '' end||'.');
  insert into public.combat_events(encounter_id,actor_character_id,target_character_id,actor_name,target_name,event_type,result,created_by)
  values(v_request.encounter_id,v_actor.character_id,v_target.character_id,v_actor.character_name,v_target.character_name,v_event_type,
    jsonb_build_object('message',v_message,'damage',v_damage,'healing',v_healing,'condition',v_condition,'pe_cost',v_pe_cost,'action_cost',v_action_cost,'outcome',v_outcome,'resolution',p_resolution),(select auth.uid()));

  update public.combat_action_requests set status='resolved',resolved_by=(select auth.uid()),resolved_at=now() where id=p_request_id;
  return jsonb_build_object('ok',true,'message',v_message,'damage',v_damage,'healing',v_healing,'condition',v_condition,'pe',v_new_pe);
end;
$function$;

revoke all on function public.apply_combat_effect(uuid,uuid,text,integer,integer,text,text) from public, anon;
revoke all on function public.update_combat_effect(uuid,text,integer,integer) from public, anon;
revoke all on function public.advance_combat_turn(uuid,uuid,boolean,boolean) from public, anon;
revoke all on function public.apply_manual_combat_vitals(uuid,integer,integer) from public, anon;
revoke all on function public.resolve_combat_action(uuid,jsonb) from public, anon;

grant execute on function public.apply_combat_effect(uuid,uuid,text,integer,integer,text,text) to authenticated;
grant execute on function public.update_combat_effect(uuid,text,integer,integer) to authenticated;
grant execute on function public.advance_combat_turn(uuid,uuid,boolean,boolean) to authenticated;
grant execute on function public.apply_manual_combat_vitals(uuid,integer,integer) to authenticated;
grant execute on function public.resolve_combat_action(uuid,jsonb) to authenticated;
