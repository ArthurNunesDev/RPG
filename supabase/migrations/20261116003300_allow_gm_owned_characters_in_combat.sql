create or replace function private.validate_combatant_character()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_campaign_id uuid;
  v_game_system text;
  v_character public.characters%rowtype;
begin
  select ce.campaign_id, ce.game_system
    into v_campaign_id, v_game_system
  from public.combat_encounters ce
  where ce.id = new.encounter_id;

  if not found or not (select private.is_campaign_gm(v_campaign_id)) then
    raise exception 'Apenas o mestre pode adicionar personagens ao combate.';
  end if;

  select c.*
    into v_character
  from public.characters c
  join public.game_systems gs on gs.id = c.game_system_id
  where c.id = new.character_id
    and c.status = 'active'
    and gs.slug = v_game_system
    and (
      (
        c.campaign_id = v_campaign_id
        and (c.campaign_approval_status = 'approved' or c.owner_id = (select auth.uid()))
      )
      or (
        c.campaign_id is null
        and c.owner_id = (select auth.uid())
      )
    )
  for key share of c;

  if not found then
    raise exception 'Personagem indisponível: ele precisa pertencer à campanha, estar aprovado ou ser uma ficha pessoal do mestre, e usar o mesmo sistema de RPG.';
  end if;

  new.character_name := v_character.name;
  new.owner_id := v_character.owner_id;
  new.side := case
    when v_character.character_type = 'player' then 'players'
    when v_character.npc_role = 'enemy' then 'enemies'
    when v_character.npc_role = 'ally' then 'allies'
    else 'neutral'
  end;
  new.turn_control := case
    when v_character.owner_id = (select auth.uid()) then 'gm'
    when v_character.character_type = 'player' then 'player'
    else 'gm'
  end;

  return new;
end;
$function$;

drop trigger if exists combatants_validate_character on public.combatants;
create trigger combatants_validate_character
before insert or update of encounter_id, character_id
on public.combatants
for each row
execute function private.validate_combatant_character();
