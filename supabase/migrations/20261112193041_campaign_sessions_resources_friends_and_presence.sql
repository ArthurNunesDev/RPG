-- Campaign sessions are created explicitly by the GM.
drop trigger if exists create_campaign_realm_session on public.campaigns;
drop function if exists private.create_campaign_realm_session();
drop function if exists private.generate_realm_session_pin();

create or replace function public.get_campaign_realm_session(p_user_id uuid, p_campaign_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare target_session private.realm_sessions%rowtype;
begin
  if p_user_id is null then raise exception 'CAMPAIGN_MEMBER_REQUIRED'; end if;
  if not exists (select 1 from public.campaign_members cm where cm.campaign_id=p_campaign_id and cm.user_id=p_user_id) then
    raise exception 'CAMPAIGN_MEMBER_REQUIRED';
  end if;
  select s.* into target_session from private.realm_sessions s
  where s.campaign_id=p_campaign_id and s.status='active';
  if not found then raise exception 'CAMPAIGN_SESSION_NOT_CREATED'; end if;
  insert into private.realm_session_members(session_id,user_id) values(target_session.id,p_user_id)
  on conflict(session_id,user_id) do nothing;
  return public.get_realm_session(p_user_id,target_session.id);
end;
$$;

create or replace function public.create_realm_session(p_user_id uuid, p_campaign_id uuid, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare new_session_id uuid;
begin
  if p_user_id is null or p_campaign_id is null or p_pin !~ '^[A-Z0-9]{8}$' or p_pin !~ '[A-Z]' or p_pin !~ '[0-9]' then
    raise exception 'INVALID_SESSION_DETAILS';
  end if;
  if not exists (select 1 from public.campaign_members cm where cm.campaign_id=p_campaign_id and cm.user_id=p_user_id and cm.role='gm') then
    raise exception 'CAMPAIGN_GM_REQUIRED';
  end if;
  if exists(select 1 from private.realm_sessions s where s.campaign_id=p_campaign_id) then
    raise exception 'CAMPAIGN_SESSION_ALREADY_CREATED';
  end if;
  insert into private.realm_sessions(campaign_id,created_by,pin,status) values(p_campaign_id,p_user_id,p_pin,'active')
  returning id into new_session_id;
  insert into private.realm_session_members(session_id,user_id) values(new_session_id,p_user_id);
  return new_session_id;
exception when unique_violation then raise exception 'SESSION_PIN_TAKEN';
end;
$$;

revoke all on function public.get_campaign_realm_session(uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_realm_session(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_campaign_realm_session(uuid,uuid) to service_role;
grant execute on function public.create_realm_session(uuid,uuid,text) to service_role;

alter table public.profiles add column if not exists friend_code text;
create or replace function private.generate_friend_code()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; bytes bytea; candidate text; i integer;
begin
  for attempt in 1..100 loop
    bytes := extensions.gen_random_bytes(8); candidate := '';
    for i in 0..7 loop candidate := candidate || substr(alphabet,(get_byte(bytes,i) % length(alphabet))+1,1); end loop;
    if not exists(select 1 from public.profiles p where p.friend_code=candidate) then return candidate; end if;
  end loop;
  raise exception 'FRIEND_CODE_GENERATION_FAILED';
end;
$$;
revoke all on function private.generate_friend_code() from public,anon,authenticated;
grant execute on function private.generate_friend_code() to authenticated;
update public.profiles set friend_code=private.generate_friend_code() where friend_code is null;
alter table public.profiles alter column friend_code set default private.generate_friend_code();
alter table public.profiles alter column friend_code set not null;
create unique index if not exists profiles_friend_code_uidx on public.profiles(friend_code);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_not_self check(requester_id<>addressee_id),
  constraint friendships_pair_unique unique(requester_id,addressee_id)
);
create index if not exists friendships_addressee_status_idx on public.friendships(addressee_id,status);
alter table public.friendships enable row level security;
revoke all on public.friendships from anon;
grant select,insert,update,delete on public.friendships to authenticated;
create policy "friendship participants read" on public.friendships for select to authenticated
using(requester_id=(select auth.uid()) or addressee_id=(select auth.uid()));
create policy "users send friend requests" on public.friendships for insert to authenticated
with check(requester_id=(select auth.uid()) and status='pending' and exists(select 1 from public.profiles p where p.id=addressee_id));
create policy "recipients manage friend requests" on public.friendships for update to authenticated
using(addressee_id=(select auth.uid()) and status='pending')
with check(addressee_id=(select auth.uid()) and status in ('accepted','declined'));
create policy "participants remove friendships" on public.friendships for delete to authenticated
using(requester_id=(select auth.uid()) or addressee_id=(select auth.uid()));

create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'offline' check(status in ('online','inactive','offline')),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon;
grant select,insert,update on public.user_presence to authenticated;
create policy "users and friends read presence" on public.user_presence for select to authenticated
using(user_id=(select auth.uid()) or exists(
  select 1 from public.friendships f where f.status='accepted'
  and ((f.requester_id=(select auth.uid()) and f.addressee_id=user_presence.user_id)
    or (f.addressee_id=(select auth.uid()) and f.requester_id=user_presence.user_id))
));
create policy "users update own presence" on public.user_presence for insert to authenticated
with check(user_id=(select auth.uid()));
create policy "users maintain own presence" on public.user_presence for update to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create or replace function public.set_my_presence(p_status text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_status not in ('online','inactive','offline') then raise exception 'INVALID_PRESENCE_STATUS'; end if;
  insert into public.user_presence(user_id,status,last_seen_at,updated_at)
  values((select auth.uid()),p_status,now(),now())
  on conflict(user_id) do update set status=excluded.status,
    last_seen_at=case when p_status='online' then now() else public.user_presence.last_seen_at end,
    updated_at=now();
end;
$$;
revoke all on function public.set_my_presence(text) from public,anon;
grant execute on function public.set_my_presence(text) to authenticated;

create table if not exists public.campaign_maps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check(char_length(btrim(title)) between 1 and 100),
  description text not null default '' check(char_length(description)<=1000),
  storage_path text not null,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaign_maps_campaign_order_idx on public.campaign_maps(campaign_id,sort_order,created_at);
alter table public.campaign_maps enable row level security;
revoke all on public.campaign_maps from anon;
grant select,insert,update,delete on public.campaign_maps to authenticated;
create policy "campaign members read visible maps" on public.campaign_maps for select to authenticated
using((select private.is_campaign_member(campaign_id)) and (is_visible or (select private.is_campaign_gm(campaign_id))));
create policy "campaign GMs manage maps" on public.campaign_maps for all to authenticated
using((select private.is_campaign_gm(campaign_id)))
with check((select private.is_campaign_gm(campaign_id)) and created_by=(select auth.uid()));

create table if not exists public.campaign_tracks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check(char_length(btrim(title)) between 1 and 100),
  storage_path text not null,
  duration_seconds integer check(duration_seconds is null or duration_seconds between 1 and 86400),
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists campaign_tracks_campaign_order_idx on public.campaign_tracks(campaign_id,sort_order,created_at);
alter table public.campaign_tracks enable row level security;
revoke all on public.campaign_tracks from anon;
grant select,insert,update,delete on public.campaign_tracks to authenticated;
create policy "campaign members read visible tracks" on public.campaign_tracks for select to authenticated
using((select private.is_campaign_member(campaign_id)) and (is_visible or (select private.is_campaign_gm(campaign_id))));
create policy "campaign GMs manage tracks" on public.campaign_tracks for all to authenticated
using((select private.is_campaign_gm(campaign_id)))
with check((select private.is_campaign_gm(campaign_id)) and created_by=(select auth.uid()));

create table if not exists public.campaign_playback (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  track_id uuid references public.campaign_tracks(id) on delete set null,
  is_playing boolean not null default false,
  position_seconds numeric(10,2) not null default 0 check(position_seconds>=0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.campaign_playback enable row level security;
revoke all on public.campaign_playback from anon;
grant select,insert,update on public.campaign_playback to authenticated;
create policy "campaign members read playback" on public.campaign_playback for select to authenticated
using((select private.is_campaign_member(campaign_id)));
create policy "campaign GMs control playback" on public.campaign_playback for all to authenticated
using((select private.is_campaign_gm(campaign_id)))
with check((select private.is_campaign_gm(campaign_id)) and updated_by=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('campaign-assets','campaign-assets',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/ogg','audio/wav','audio/mp4','audio/webm'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "campaign members read campaign assets" on storage.objects for select to authenticated
using(bucket_id='campaign-assets' and exists(select 1 from public.campaign_members cm where cm.campaign_id=((storage.foldername(name))[1])::uuid and cm.user_id=(select auth.uid())));
create policy "campaign GMs upload campaign assets" on storage.objects for insert to authenticated
with check(bucket_id='campaign-assets' and exists(select 1 from public.campaign_members cm where cm.campaign_id=((storage.foldername(name))[1])::uuid and cm.user_id=(select auth.uid()) and cm.role='gm'));
create policy "campaign GMs update campaign assets" on storage.objects for update to authenticated
using(bucket_id='campaign-assets' and exists(select 1 from public.campaign_members cm where cm.campaign_id=((storage.foldername(name))[1])::uuid and cm.user_id=(select auth.uid()) and cm.role='gm'))
with check(bucket_id='campaign-assets' and exists(select 1 from public.campaign_members cm where cm.campaign_id=((storage.foldername(name))[1])::uuid and cm.user_id=(select auth.uid()) and cm.role='gm'));
create policy "campaign GMs delete campaign assets" on storage.objects for delete to authenticated
using(bucket_id='campaign-assets' and exists(select 1 from public.campaign_members cm where cm.campaign_id=((storage.foldername(name))[1])::uuid and cm.user_id=(select auth.uid()) and cm.role='gm'));

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_presence') then alter publication supabase_realtime add table public.user_presence; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='friendships') then alter publication supabase_realtime add table public.friendships; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='campaign_maps') then alter publication supabase_realtime add table public.campaign_maps; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='campaign_tracks') then alter publication supabase_realtime add table public.campaign_tracks; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='campaign_playback') then alter publication supabase_realtime add table public.campaign_playback; end if;
 end if;
end $$;
