drop policy if exists "campaign members submit characters and GMs create NPCs" on public.characters;

create policy "campaign members submit characters and GMs create NPCs"
  on public.characters
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      (
        campaign_id is null
        and character_type = 'player'
        and npc_role is null
        and campaign_approval_status = 'not_submitted'
        and exists (
          select 1
          from public.game_systems gs
          where gs.id = characters.game_system_id
            and (gs.is_official or gs.created_by = (select auth.uid()))
        )
      )
      or (
        campaign_id is not null
        and exists (
          select 1
          from public.campaigns c
          where c.id = characters.campaign_id
            and c.game_system_id = characters.game_system_id
        )
        and (
          (
            character_type = 'player'
            and npc_role is null
            and campaign_approval_status = 'pending'
            and exists (
              select 1
              from public.campaign_members cm
              where cm.campaign_id = characters.campaign_id
                and cm.user_id = (select auth.uid())
                and cm.role = 'player'
            )
          )
          or (
            character_type = 'player'
            and npc_role is null
            and campaign_approval_status = 'approved'
            and (select private.is_campaign_gm(characters.campaign_id))
          )
          or (
            character_type = 'npc'
            and npc_role in ('ally', 'enemy', 'neutral')
            and campaign_approval_status = 'approved'
            and (select private.is_campaign_gm(characters.campaign_id))
          )
        )
      )
    )
  );
