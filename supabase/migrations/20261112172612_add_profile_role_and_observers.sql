alter table public.profiles
  add column if not exists preferred_role text
  check (preferred_role in ('gm', 'player', 'observer'));

comment on column public.profiles.preferred_role is
  'User-selected default REALMS experience; not an authorization claim. Campaign permissions are enforced by campaign_members and RLS.';

alter table public.campaign_members
  drop constraint if exists campaign_members_role_check;

alter table public.campaign_members
  add constraint campaign_members_role_check
  check (role in ('gm', 'player', 'observer'));

drop policy if exists "game masters add players" on public.campaign_members;
drop policy if exists "game masters add participants" on public.campaign_members;

create policy "game masters add participants"
  on public.campaign_members for insert to authenticated
  with check (
    role in ('player', 'observer')
    and (select private.is_campaign_gm(campaign_id))
  );
