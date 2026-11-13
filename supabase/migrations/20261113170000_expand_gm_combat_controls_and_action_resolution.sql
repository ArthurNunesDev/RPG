alter table public.combat_encounters
  add column if not exists turns_paused boolean not null default false,
  add column if not exists current_turn_note text not null default '';

alter table public.combatants
  add column if not exists turn_order integer,
  add column if not exists turn_blocked boolean not null default false,
  add column if not exists turn_control text not null default 'gm' check (turn_control in ('gm','player')),
  add column if not exists defense integer not null default 10,
  add column if not exists sheet_snapshot jsonb not null default '{}'::jsonb;

with ranked as (
  select id, row_number() over (partition by encounter_id order by initiative desc, sort_order asc)::integer as position
  from public.combatants
)
update public.combatants cb set turn_order = ranked.position
from ranked where cb.id = ranked.id and cb.turn_order is null;
update public.combatants set turn_order = 0 where turn_order is null;
alter table public.combatants alter column turn_order set default 0;
alter table public.combatants alter column turn_order set not null;
create index if not exists combatants_manual_turn_order_idx on public.combatants(encounter_id, turn_order);

drop policy if exists "players request own combat actions" on public.combat_action_requests;
create policy "players request own combat actions" on public.combat_action_requests
for insert to authenticated with check (
 requested_by = (select auth.uid()) and status = 'pending' and resolved_by is null
 and exists (
  select 1 from public.combat_encounters e
  join public.characters c on c.id = actor_character_id
  join public.combatants cb on cb.encounter_id = e.id and cb.character_id = c.id
  where e.id = encounter_id and e.status = 'active' and e.turns_paused = false
   and c.owner_id = (select auth.uid()) and c.character_type = 'player'
   and cb.is_active and cb.turn_blocked = false and cb.turn_control = 'player'
   and cb.id = (
     select current_cb.id from public.combatants current_cb
     where current_cb.encounter_id = e.id and current_cb.is_active and not current_cb.turn_blocked
     order by current_cb.turn_order asc limit 1 offset e.turn_index
   )
   and (select private.is_realm_session_member(e.session_id))
 )
);

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
  v_event_type text;
  v_message text;
begin
  if p_resolution is null or jsonb_typeof(p_resolution) <> 'object' then
    raise exception 'Resolução inválida.';
  end if;
  select * into v_request from public.combat_action_requests where id = p_request_id for update;
  if not found then raise exception 'Solicitação não encontrada.'; end if;
  select * into v_encounter from public.combat_encounters where id = v_request.encounter_id for update;
  if not found or v_encounter.status <> 'active' then raise exception 'Combate não está ativo.'; end if;
  if not (select private.is_campaign_gm(v_encounter.campaign_id)) then raise exception 'Apenas o mestre pode resolver ações.'; end if;
  if v_request.status <> 'pending' then raise exception 'Esta ação já foi processada.'; end if;

  select * into v_actor from public.combatants
   where encounter_id = v_request.encounter_id and character_id = v_request.actor_character_id for update;
  if not found then raise exception 'Combatente não encontrado.'; end if;

  if v_request.target_character_id is not null then
    select * into v_target from public.combatants
     where encounter_id = v_request.encounter_id and character_id = v_request.target_character_id for update;
    if not found then raise exception 'Alvo não encontrado neste combate.'; end if;
  end if;

  if v_pe_cost > v_actor.current_pe then raise exception 'PE insuficientes.'; end if;
  if v_request.action_type in ('attack','ability') and v_target.id is not null and v_damage > 0 then
    update public.combatants set current_hp = greatest(0, current_hp - v_damage), updated_at = now()
    where id = v_target.id;
  end if;
  if v_healing > 0 then
    if v_target.id is null then raise exception 'Selecione um alvo para aplicar a cura.'; end if;
    update public.combatants set current_hp = least(max_hp, current_hp + v_healing), updated_at = now()
    where id = v_target.id;
  end if;
  update public.combatants set current_pe = current_pe - v_pe_cost, updated_at = now()
   where id = v_actor.id;

  v_event_type := case
    when v_request.action_type in ('dodge','counterattack','defend') then 'reaction'
    when v_healing > 0 then 'healing'
    when v_damage > 0 then 'damage'
    when v_request.action_type = 'attack' then 'attack'
    else 'ability'
  end;
  v_message := coalesce(p_resolution->>'message',
    v_actor.character_name || ' executou ' || v_request.action_type ||
    case when v_target.id is not null then ' contra ' || v_target.character_name else '' end || '.');
  insert into public.combat_events(encounter_id, actor_character_id, target_character_id, actor_name, target_name, event_type, result, created_by)
  values (v_request.encounter_id, v_actor.character_id, v_target.character_id, v_actor.character_name, v_target.character_name, v_event_type,
    jsonb_build_object('message',v_message,'damage',v_damage,'healing',v_healing,'pe_cost',v_pe_cost,'resolution',p_resolution), (select auth.uid()));

  update public.combat_action_requests set status = 'resolved', resolved_by = (select auth.uid()), resolved_at = now()
   where id = p_request_id;
  return jsonb_build_object('ok',true,'message',v_message,'damage',v_damage,'healing',v_healing);
end;
$function$;

revoke all on function public.resolve_combat_action(uuid,jsonb) from public, anon;
grant execute on function public.resolve_combat_action(uuid,jsonb) to authenticated;
