drop policy if exists "users create their own characters" on public.characters;
create policy "campaign participants create characters"
  on public.characters for insert to authenticated
  with check (
    owner_id = (select auth.uid())
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
  );

drop policy if exists "owners and game masters update characters" on public.characters;
create policy "owners and game masters update characters"
  on public.characters for update to authenticated
  using (
    (
      owner_id = (select auth.uid())
      and (
        campaign_id is null
        or exists (
          select 1 from public.campaign_members cm
          where cm.campaign_id = characters.campaign_id
            and cm.user_id = (select auth.uid())
            and cm.role in ('gm', 'player')
        )
      )
    )
    or (
      campaign_id is not null
      and (select private.is_campaign_gm(campaign_id))
    )
  )
  with check (
    (
      owner_id = (select auth.uid())
      and (
        campaign_id is null
        or exists (
          select 1 from public.campaign_members cm
          where cm.campaign_id = characters.campaign_id
            and cm.user_id = (select auth.uid())
            and cm.role in ('gm', 'player')
        )
      )
    )
    or (
      campaign_id is not null
      and (select private.is_campaign_gm(campaign_id))
    )
  );

drop policy if exists "owners and game masters delete characters" on public.characters;
create policy "owners and game masters delete characters"
  on public.characters for delete to authenticated
  using (
    (
      owner_id = (select auth.uid())
      and (
        campaign_id is null
        or exists (
          select 1 from public.campaign_members cm
          where cm.campaign_id = characters.campaign_id
            and cm.user_id = (select auth.uid())
            and cm.role in ('gm', 'player')
        )
      )
    )
    or (
      campaign_id is not null
      and (select private.is_campaign_gm(campaign_id))
    )
  );
