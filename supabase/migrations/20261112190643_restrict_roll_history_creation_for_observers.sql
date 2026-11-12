create or replace function private.can_roll_in_campaign(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.campaign_members cm
    where cm.campaign_id = p_campaign_id
      and cm.user_id = (select auth.uid())
      and cm.role in ('gm', 'player')
  );
$$;

revoke all on function private.can_roll_in_campaign(uuid) from public, anon;
grant execute on function private.can_roll_in_campaign(uuid) to authenticated;

drop policy if exists "users create their own roll history" on public.roll_history;
create policy "users create their own roll history"
on public.roll_history for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (
    (
      campaign_id is null
      and scope = 'personal'
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and p.preferred_role in ('gm', 'player')
      )
    )
    or (
      campaign_id is not null
      and (select private.can_roll_in_campaign(campaign_id))
    )
  )
);
