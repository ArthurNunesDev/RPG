drop policy if exists "owners and game masters delete characters" on public.characters;
create policy "owners and game masters delete characters"
  on public.characters for delete to authenticated
  using (
    (
      owner_id = (select auth.uid())
      and (
        (campaign_id is null and character_type = 'player')
        or (
          campaign_id is not null
          and character_type = 'player'
          and exists (
            select 1 from public.campaign_members cm
            where cm.campaign_id = characters.campaign_id
              and cm.user_id = (select auth.uid())
              and cm.role in ('gm', 'player')
          )
        )
        or (
          campaign_id is not null
          and character_type = 'npc'
          and (select private.is_campaign_gm(campaign_id))
        )
      )
    )
    or (
      campaign_id is not null
      and (select private.is_campaign_gm(campaign_id))
    )
  );
