alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb
  check (jsonb_typeof(preferences) = 'object');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users upload their own profile avatar" on storage.objects;
create policy "users upload their own profile avatar"
on storage.objects for insert to authenticated
with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "users update their own profile avatar" on storage.objects;
create policy "users update their own profile avatar"
on storage.objects for update to authenticated
using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "users delete their own profile avatar" on storage.objects;
create policy "users delete their own profile avatar"
on storage.objects for delete to authenticated
using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table if not exists public.roll_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  scope text not null check (scope in ('personal','campaign')),
  formula text not null check (char_length(btrim(formula)) between 1 and 80),
  rolls jsonb not null check (jsonb_typeof(rolls) = 'array'),
  total integer not null,
  created_at timestamptz not null default now(),
  constraint roll_history_scope_campaign_check check ((scope = 'campaign' and campaign_id is not null) or scope = 'personal')
);

create index if not exists roll_history_user_recent_idx on public.roll_history(user_id, created_at desc);
create index if not exists roll_history_campaign_recent_idx on public.roll_history(campaign_id, scope, created_at desc) where campaign_id is not null;

alter table public.roll_history enable row level security;
revoke all on public.roll_history from anon;
grant select, insert, delete on public.roll_history to authenticated;

drop policy if exists "users and campaign masters read permitted roll history" on public.roll_history;
create policy "users and campaign masters read permitted roll history"
on public.roll_history for select to authenticated
using (
  user_id = (select auth.uid())
  or (campaign_id is not null and scope = 'personal' and (select private.is_campaign_gm(campaign_id)))
  or (campaign_id is not null and scope = 'campaign' and (select private.is_campaign_member(campaign_id)))
);

drop policy if exists "users create their own roll history" on public.roll_history;
create policy "users create their own roll history"
on public.roll_history for insert to authenticated
with check (
  user_id = (select auth.uid())
  and ((campaign_id is null and scope = 'personal') or (campaign_id is not null and (select private.is_campaign_member(campaign_id))))
);

drop policy if exists "users delete their own roll history" on public.roll_history;
create policy "users delete their own roll history"
on public.roll_history for delete to authenticated
using (user_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'roll_history')
  then
    alter publication supabase_realtime add table public.roll_history;
  end if;
end;
$$;
