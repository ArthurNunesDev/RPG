-- REALMS initial schema: profiles, game systems, campaigns, characters and campaign chat.
-- All application data is scoped through authenticated users and campaign membership.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 50),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_name text;
begin
  candidate_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Aventureiro'
  );

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    'player_' || left(replace(new.id::text, '-', ''), 12),
    left(candidate_name, 50)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_realms on auth.users;
create trigger on_auth_user_created_realms
  after insert on auth.users
  for each row execute function private.handle_new_user();

create table if not exists public.game_systems (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
  name text not null
    check (char_length(btrim(name)) between 2 and 80),
  description text not null default '',
  is_official boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  character_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(character_schema) = 'object'),
  dice_rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(dice_rules) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_systems_creator_visibility_check
    check (not is_official or created_by is null)
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  game_system_id uuid not null references public.game_systems(id) on delete restrict,
  title text not null
    check (char_length(btrim(title)) between 3 and 100),
  description text not null default '',
  cover_url text,
  visibility text not null default 'private'
    check (visibility = 'private'),
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_members (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'player'
    check (role in ('gm', 'player')),
  joined_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  game_system_id uuid not null references public.game_systems(id) on delete restrict,
  name text not null
    check (char_length(btrim(name)) between 1 and 80),
  concept text not null default '',
  avatar_url text,
  sheet jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sheet) = 'object'),
  status text not null default 'active'
    check (status in ('active', 'retired', 'deceased')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  content text not null
    check (char_length(btrim(content)) between 1 and 2000),
  message_type text not null default 'chat'
    check (message_type in ('chat', 'system')),
  created_at timestamptz not null default now()
);

create index if not exists campaigns_owner_updated_idx
  on public.campaigns (owner_id, updated_at desc);
create index if not exists campaign_members_user_idx
  on public.campaign_members (user_id, campaign_id);
create index if not exists characters_owner_updated_idx
  on public.characters (owner_id, updated_at desc);
create index if not exists characters_campaign_idx
  on public.characters (campaign_id) where campaign_id is not null;
create index if not exists campaign_messages_recent_idx
  on public.campaign_messages (campaign_id, created_at desc);

create or replace function private.is_campaign_member(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
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
as $$
  select exists (
    select 1
    from public.campaign_members cm
    where cm.campaign_id = p_campaign_id
      and cm.user_id = (select auth.uid())
      and cm.role = 'gm'
  );
$$;

revoke all on function private.is_campaign_member(uuid) from public, anon;
revoke all on function private.is_campaign_gm(uuid) from public, anon;
grant execute on function private.is_campaign_member(uuid) to authenticated;
grant execute on function private.is_campaign_gm(uuid) to authenticated;

create or replace function private.add_campaign_owner_as_gm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.campaign_members (campaign_id, user_id, role)
  values (new.id, new.owner_id, 'gm')
  on conflict (campaign_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists add_campaign_owner_as_gm on public.campaigns;
create trigger add_campaign_owner_as_gm
  after insert on public.campaigns
  for each row execute function private.add_campaign_owner_as_gm();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

drop trigger if exists game_systems_set_updated_at on public.game_systems;
create trigger game_systems_set_updated_at
  before update on public.game_systems
  for each row execute function private.set_updated_at();

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function private.set_updated_at();

drop trigger if exists characters_set_updated_at on public.characters;
create trigger characters_set_updated_at
  before update on public.characters
  for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.game_systems enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.characters enable row level security;
alter table public.campaign_messages enable row level security;

revoke all on public.profiles, public.game_systems, public.campaigns,
  public.campaign_members, public.characters, public.campaign_messages
from anon;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.game_systems to authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, delete on public.campaign_members to authenticated;
grant select, insert, update, delete on public.characters to authenticated;
grant select, insert on public.campaign_messages to authenticated;

drop policy if exists "profiles are visible to authenticated users" on public.profiles;
create policy "profiles are visible to authenticated users"
  on public.profiles for select to authenticated
  using (true);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "users read available game systems" on public.game_systems;
create policy "users read available game systems"
  on public.game_systems for select to authenticated
  using (is_official or created_by = (select auth.uid()));

drop policy if exists "users create custom game systems" on public.game_systems;
create policy "users create custom game systems"
  on public.game_systems for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and is_official = false
  );

drop policy if exists "creators update custom game systems" on public.game_systems;
create policy "creators update custom game systems"
  on public.game_systems for update to authenticated
  using (created_by = (select auth.uid()) and is_official = false)
  with check (created_by = (select auth.uid()) and is_official = false);

drop policy if exists "creators delete custom game systems" on public.game_systems;
create policy "creators delete custom game systems"
  on public.game_systems for delete to authenticated
  using (created_by = (select auth.uid()) and is_official = false);

drop policy if exists "campaign members read campaigns" on public.campaigns;
create policy "campaign members read campaigns"
  on public.campaigns for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select private.is_campaign_member(id))
  );

drop policy if exists "users create their own campaigns" on public.campaigns;
create policy "users create their own campaigns"
  on public.campaigns for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.game_systems gs
      where gs.id = game_system_id
        and (gs.is_official or gs.created_by = (select auth.uid()))
    )
  );

drop policy if exists "campaign owners update campaigns" on public.campaigns;
create policy "campaign owners update campaigns"
  on public.campaigns for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.game_systems gs
      where gs.id = game_system_id
        and (gs.is_official or gs.created_by = (select auth.uid()))
    )
  );

drop policy if exists "campaign owners delete campaigns" on public.campaigns;
create policy "campaign owners delete campaigns"
  on public.campaigns for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "campaign members read membership" on public.campaign_members;
create policy "campaign members read membership"
  on public.campaign_members for select to authenticated
  using ((select private.is_campaign_member(campaign_id)));

drop policy if exists "game masters add players" on public.campaign_members;
create policy "game masters add players"
  on public.campaign_members for insert to authenticated
  with check (
    role = 'player'
    and (select private.is_campaign_gm(campaign_id))
  );

drop policy if exists "game masters remove players or players leave" on public.campaign_members;
create policy "game masters remove players or players leave"
  on public.campaign_members for delete to authenticated
  using (
    (role = 'player' and (select private.is_campaign_gm(campaign_id)))
    or (user_id = (select auth.uid()) and role = 'player')
  );

drop policy if exists "owners and campaign members read characters" on public.characters;
create policy "owners and campaign members read characters"
  on public.characters for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      campaign_id is not null
      and (select private.is_campaign_member(campaign_id))
    )
  );

drop policy if exists "users create their own characters" on public.characters;
create policy "users create their own characters"
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
        and (select private.is_campaign_member(campaign_id))
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
    owner_id = (select auth.uid())
    or (
      campaign_id is not null
      and (select private.is_campaign_gm(campaign_id))
    )
  )
  with check (
    (
      owner_id = (select auth.uid())
      or (
        campaign_id is not null
        and (select private.is_campaign_gm(campaign_id))
      )
    )
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
        and (select private.is_campaign_member(campaign_id))
        and exists (
          select 1 from public.campaigns c
          where c.id = campaign_id
            and c.game_system_id = characters.game_system_id
        )
      )
    )
  );

drop policy if exists "owners and game masters delete characters" on public.characters;
create policy "owners and game masters delete characters"
  on public.characters for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      campaign_id is not null
      and (select private.is_campaign_gm(campaign_id))
    )
  );

drop policy if exists "campaign members read campaign messages" on public.campaign_messages;
create policy "campaign members read campaign messages"
  on public.campaign_messages for select to authenticated
  using ((select private.is_campaign_member(campaign_id)));

drop policy if exists "campaign members send messages" on public.campaign_messages;
create policy "campaign members send messages"
  on public.campaign_messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and message_type = 'chat'
    and (select private.is_campaign_member(campaign_id))
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'campaign_members'
    ) then
      alter publication supabase_realtime add table public.campaign_members;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'characters'
    ) then
      alter publication supabase_realtime add table public.characters;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'campaign_messages'
    ) then
      alter publication supabase_realtime add table public.campaign_messages;
    end if;
  end if;
end;
$$;
