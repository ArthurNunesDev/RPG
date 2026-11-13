alter table public.characters
  add column if not exists is_visible_to_players boolean not null default true;

drop policy if exists "owners game masters and approved campaign members read characte" on public.characters;

create policy "campaign members read visible characters"
  on public.characters for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      campaign_id is not null
      and (select private.is_campaign_gm(campaign_id))
    )
    or (
      campaign_id is not null
      and is_visible_to_players = true
      and campaign_approval_status = 'approved'
      and (select private.is_campaign_member(campaign_id))
    )
  );
