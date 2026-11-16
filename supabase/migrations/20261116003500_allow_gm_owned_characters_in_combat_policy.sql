create or replace function private.combatant_matches_encounter(
  p_encounter_id uuid,
  p_character_id uuid,
  p_owner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.combat_encounters e
    join public.characters c
      on c.id = p_character_id
     and c.owner_id = p_owner_id
    where e.id = p_encounter_id
      and (select private.session_matches_campaign(e.session_id, e.campaign_id))
      and (
        (
          c.campaign_id = e.campaign_id
          and (
            c.campaign_approval_status = 'approved'
            or (
              c.owner_id = (select auth.uid())
              and (select private.is_campaign_gm(e.campaign_id))
            )
          )
        )
        or (
          c.campaign_id is null
          and (
            (
              c.owner_id = (select auth.uid())
              and (select private.is_campaign_gm(e.campaign_id))
            )
            or exists (
              select 1
              from public.campaign_members cm
              where cm.campaign_id = e.campaign_id
                and cm.user_id = c.owner_id
            )
          )
        )
      )
  );
$function$;
