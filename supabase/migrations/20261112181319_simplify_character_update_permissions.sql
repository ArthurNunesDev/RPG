drop policy if exists "owners and game masters update characters" on public.characters;

create policy "owners and game masters update characters"
  on public.characters for update to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      campaign_id is not null
      and (select private.is_campaign_gm(campaign_id))
    )
  )
  with check (
    (
      owner_id = (select auth.uid())
      and character_type = 'player'
      and npc_role is null
      and (
        (
          campaign_id is null
          and exists (
            select 1 from public.game_systems gs
            where gs.id = game_system_id
              and (gs.is_official or gs.created_by = (select auth.uid()))
          )
        )
        or (
          campaign_id is not null
          and exists (
            select 1 from public.campaign_members cm
            where cm.campaign_id = characters.campaign_id
              and cm.user_id = (select auth.uid())
              and cm.role in ('gm', 'player')
          )
          and exists (
            select 1 from public.campaigns c
            where c.id = campaign_id
              and c.game_system_id = characters.game_system_id
          )
        )
      )
    )
    or (
      campaign_id is not null
      and (select private.is_campaign_gm(campaign_id))
      and exists (
        select 1 from public.campaigns c
        where c.id = campaign_id
          and c.game_system_id = characters.game_system_id
      )
      and (
        (character_type = 'player' and npc_role is null)
        or (character_type = 'npc' and npc_role in ('ally', 'enemy', 'neutral'))
      )
    )
  );
