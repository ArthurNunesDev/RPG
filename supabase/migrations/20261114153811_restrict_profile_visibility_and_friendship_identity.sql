-- Restrict public profile discovery and make friendship endpoints immutable.

drop policy if exists "profiles are visible to authenticated users" on public.profiles;
create policy "users read connected profiles"
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.friendships f
      where f.status in ('pending','accepted')
        and (
          (f.requester_id = (select auth.uid()) and f.addressee_id = profiles.id)
          or
          (f.addressee_id = (select auth.uid()) and f.requester_id = profiles.id)
        )
    )
    or exists (
      select 1
      from public.campaign_members mine
      join public.campaign_members other
        on other.campaign_id = mine.campaign_id
      where mine.user_id = (select auth.uid())
        and other.user_id = profiles.id
    )
  );

create or replace function private.protect_friendship_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.requester_id is distinct from old.requester_id
     or new.addressee_id is distinct from old.addressee_id
     or new.created_at is distinct from old.created_at then
    raise exception 'FRIENDSHIP_PARTICIPANTS_IMMUTABLE';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.protect_friendship_identity() from public,anon;
grant execute on function private.protect_friendship_identity() to authenticated;

drop trigger if exists friendships_protect_identity on public.friendships;
create trigger friendships_protect_identity
  before update on public.friendships
  for each row
  execute function private.protect_friendship_identity();

alter table public.friendships
  drop constraint if exists friendships_pair_unique;

create unique index if not exists friendships_unordered_pair_unique
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );
