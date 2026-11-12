drop policy if exists "game masters remove players or players leave" on public.campaign_members;
create policy "game masters remove participants or participants leave"
  on public.campaign_members for delete to authenticated
  using (
    (role in ('player', 'observer') and (select private.is_campaign_gm(campaign_id)))
    or (user_id = (select auth.uid()) and role in ('player', 'observer'))
  );

drop policy if exists "campaign members send messages" on public.campaign_messages;
create policy "players and game masters send messages"
  on public.campaign_messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and message_type = 'chat'
    and exists (
      select 1 from public.campaign_members cm
      where cm.campaign_id = campaign_messages.campaign_id
        and cm.user_id = (select auth.uid())
        and cm.role in ('gm', 'player')
    )
  );
