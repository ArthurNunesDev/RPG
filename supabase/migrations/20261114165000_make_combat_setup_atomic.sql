-- Create encounters and add combatants in single database transactions.

create or replace function public.start_combat_encounter(
  p_session_id uuid,
  p_campaign_id uuid,
  p_game_system text,
  p_combatants jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_encounter public.combat_encounters%rowtype;
  v_combatant public.combatants%rowtype;
  v_item jsonb;
  v_count integer := 0;
begin
  if p_combatants is null or jsonb_typeof(p_combatants) <> 'array'
     or jsonb_array_length(p_combatants) < 1
     or jsonb_array_length(p_combatants) > 50 then
    raise exception 'A lista de combatentes deve conter entre 1 e 50 personagens.';
  end if;
  if p_game_system <> 'ordem-paranormal' then
    raise exception 'Sistema de combate ainda não disponível.';
  end if;
  if not (select private.is_campaign_gm(p_campaign_id)) then
    raise exception 'Apenas o mestre pode iniciar o combate.';
  end if;
  if not (select private.is_realm_session_for_campaign(p_session_id, p_campaign_id)) then
    raise exception 'A sessão não pertence à campanha selecionada.';
  end if;

  insert into public.combat_encounters (
    session_id, campaign_id, game_system, status, started_by
  )
  values (
    p_session_id, p_campaign_id, p_game_system, 'active', (select auth.uid())
  )
  returning * into v_encounter;

  for v_item in select value from jsonb_array_elements(p_combatants)
  loop
    insert into public.combatants (
      encounter_id, character_id, character_name, owner_id, side,
      initiative, initiative_rolls, is_surprised, current_hp, max_hp,
      current_pe, max_pe, current_pd, max_pd, defense, turn_order,
      sort_order, turn_control
    )
    values (
      v_encounter.id,
      (v_item->>'character_id')::uuid,
      btrim(v_item->>'character_name'),
      (v_item->>'owner_id')::uuid,
      v_item->>'side',
      coalesce((v_item->>'initiative')::integer, 0),
      coalesce(v_item->'initiative_rolls', '[]'::jsonb),
      coalesce((v_item->>'is_surprised')::boolean, false),
      greatest(0, coalesce((v_item->>'current_hp')::integer, 0)),
      greatest(0, coalesce((v_item->>'max_hp')::integer, 0)),
      greatest(0, coalesce((v_item->>'current_pe')::integer, 0)),
      greatest(0, coalesce((v_item->>'max_pe')::integer, 0)),
      greatest(0, coalesce((v_item->>'current_pd')::integer, 0)),
      greatest(0, coalesce((v_item->>'max_pd')::integer, 0)),
      greatest(0, coalesce((v_item->>'defense')::integer, 10)),
      greatest(0, coalesce((v_item->>'turn_order')::integer, v_count + 1)),
      greatest(0, coalesce((v_item->>'sort_order')::integer, v_count)),
      case when v_item->>'turn_control' = 'player' then 'player' else 'gm' end
    )
    returning * into v_combatant;

    insert into public.combatant_sheets (
      combatant_id, character_id, owner_id, sheet_snapshot
    )
    values (
      v_combatant.id,
      v_combatant.character_id,
      v_combatant.owner_id,
      case
        when jsonb_typeof(v_item->'sheet_snapshot') = 'object' then v_item->'sheet_snapshot'
        else '{}'::jsonb
      end
    );

    insert into public.combat_events (
      encounter_id, actor_character_id, actor_name, event_type, result, created_by
    )
    values (
      v_encounter.id, v_combatant.character_id, v_combatant.character_name, 'initiative',
      jsonb_build_object(
        'total', v_combatant.initiative,
        'rolls', v_combatant.initiative_rolls,
        'message', format('%s entrou no combate.', v_combatant.character_name)
      ),
      (select auth.uid())
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'encounter_id', v_encounter.id,
    'combatants_count', v_count
  );
end;
$$;

create or replace function public.add_combatant_to_encounter(
  p_encounter_id uuid,
  p_combatant jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_encounter public.combat_encounters%rowtype;
  v_combatant public.combatants%rowtype;
  v_sheet jsonb;
  v_message text;
begin
  if p_combatant is null or jsonb_typeof(p_combatant) <> 'object' then
    raise exception 'Dados do combatente inválidos.';
  end if;

  select * into v_encounter
  from public.combat_encounters
  where id = p_encounter_id
  for update;

  if not found or v_encounter.status <> 'active' then
    raise exception 'Combate não está ativo.';
  end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then
    raise exception 'Apenas o mestre pode adicionar combatentes.';
  end if;
  if not (select private.is_realm_session_for_campaign(v_encounter.session_id, v_encounter.campaign_id)) then
    raise exception 'A sessão não pertence à campanha deste combate.';
  end if;

  v_sheet := case
    when jsonb_typeof(p_combatant->'sheet_snapshot') = 'object' then p_combatant->'sheet_snapshot'
    else '{}'::jsonb
  end;

  insert into public.combatants (
    encounter_id, character_id, character_name, owner_id, side,
    initiative, initiative_rolls, is_surprised, current_hp, max_hp,
    current_pe, max_pe, current_pd, max_pd, defense, turn_order,
    sort_order, turn_control
  )
  values (
    p_encounter_id,
    (p_combatant->>'character_id')::uuid,
    btrim(p_combatant->>'character_name'),
    (p_combatant->>'owner_id')::uuid,
    p_combatant->>'side',
    coalesce((p_combatant->>'initiative')::integer, 0),
    coalesce(p_combatant->'initiative_rolls', '[]'::jsonb),
    coalesce((p_combatant->>'is_surprised')::boolean, false),
    greatest(0, coalesce((p_combatant->>'current_hp')::integer, 0)),
    greatest(0, coalesce((p_combatant->>'max_hp')::integer, 0)),
    greatest(0, coalesce((p_combatant->>'current_pe')::integer, 0)),
    greatest(0, coalesce((p_combatant->>'max_pe')::integer, 0)),
    greatest(0, coalesce((p_combatant->>'current_pd')::integer, 0)),
    greatest(0, coalesce((p_combatant->>'max_pd')::integer, 0)),
    greatest(0, coalesce((p_combatant->>'defense')::integer, 10)),
    greatest(0, coalesce((p_combatant->>'turn_order')::integer, 0)),
    greatest(0, coalesce((p_combatant->>'sort_order')::integer, 0)),
    case when p_combatant->>'turn_control' = 'player' then 'player' else 'gm' end
  )
  returning * into v_combatant;

  insert into public.combatant_sheets (
    combatant_id, character_id, owner_id, sheet_snapshot
  )
  values (
    v_combatant.id, v_combatant.character_id, v_combatant.owner_id, v_sheet
  );

  v_message := format('%s entrou no combate.', v_combatant.character_name);
  insert into public.combat_events (
    encounter_id, actor_character_id, actor_name, event_type, result, created_by
  )
  values (
    p_encounter_id, v_combatant.character_id, v_combatant.character_name,
    'initiative', jsonb_build_object('total', v_combatant.initiative, 'rolls', v_combatant.initiative_rolls, 'message', v_message),
    (select auth.uid())
  );

  return jsonb_build_object('ok', true, 'combatant_id', v_combatant.id, 'message', v_message);
end;
$$;

revoke all on function public.start_combat_encounter(uuid,uuid,text,jsonb) from public, anon;
revoke all on function public.add_combatant_to_encounter(uuid,jsonb) from public, anon;
grant execute on function public.start_combat_encounter(uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.add_combatant_to_encounter(uuid,jsonb) to authenticated;
