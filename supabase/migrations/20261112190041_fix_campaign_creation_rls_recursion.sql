-- Prevent RLS recursion when a campaign creator selects a custom system
-- that is already shared through another campaign.
create or replace function private.is_campaign_member(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.campaign_members cm
    where cm.campaign_id = p_campaign_id
      and cm.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_campaign_gm(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.campaign_members cm
    where cm.campaign_id = p_campaign_id
      and cm.user_id = (select auth.uid())
      and cm.role = 'gm'
  );
$$;

create or replace function private.is_game_system_shared_with_member(p_game_system_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.campaigns c
    join public.campaign_members cm on cm.campaign_id = c.id
    where c.game_system_id = p_game_system_id
      and cm.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_game_system_shared_with_member(uuid) from public, anon;
grant execute on function private.is_game_system_shared_with_member(uuid) to authenticated;

drop policy if exists "users read available game systems" on public.game_systems;
create policy "users read available game systems"
on public.game_systems
for select
to authenticated
using (
  is_official
  or created_by = (select auth.uid())
  or (select private.is_game_system_shared_with_member(id))
);
