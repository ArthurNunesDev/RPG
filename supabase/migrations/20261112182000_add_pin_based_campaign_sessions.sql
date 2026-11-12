-- Persistent campaign sessions with PIN entry and read-only observer access.
create table if not exists private.realm_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  pin text not null unique
    check (pin ~ '^[A-Z0-9]{8}$' and pin ~ '[A-Z]' and pin ~ '[0-9]'),
  status text not null default 'active'
    check (status in ('active', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint realm_sessions_end_state_check check (
    (status = 'active' and ended_at is null)
    or (status = 'ended' and ended_at is not null)
  )
);
create unique index if not exists realm_sessions_one_active_per_campaign_idx on private.realm_sessions(campaign_id) where status='active';
create index if not exists realm_sessions_campaign_created_idx on private.realm_sessions(campaign_id,created_at desc);
create table if not exists private.realm_session_members (
  session_id uuid not null references private.realm_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(session_id,user_id)
);
create index if not exists realm_session_members_user_idx on private.realm_session_members(user_id,session_id);
create table if not exists private.realm_session_pin_attempts (
  id bigint generated always as identity primary key,
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null default now()
);
create index if not exists realm_session_pin_attempts_fingerprint_time_idx on private.realm_session_pin_attempts(fingerprint,attempted_at desc);
alter table private.realm_sessions enable row level security;
alter table private.realm_session_members enable row level security;
alter table private.realm_session_pin_attempts enable row level security;
revoke all on private.realm_sessions,private.realm_session_members,private.realm_session_pin_attempts from public,anon,authenticated;
grant all on private.realm_sessions,private.realm_session_members,private.realm_session_pin_attempts to service_role;
create or replace function private.is_realm_session_member(p_session_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select p_session_id is not null and exists(select 1 from private.realm_session_members m where m.session_id=p_session_id and m.user_id=(select auth.uid()));
$$;
create or replace function private.can_access_realm_session_topic(p_topic text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare session_text text;
begin
 if p_topic !~ '^realm-session:[0-9a-fA-F-]{36}$' then return false; end if;
 session_text:=substring(p_topic from length('realm-session:')+1);
 return private.is_realm_session_member(session_text::uuid);
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function private.is_realm_session_member(uuid),private.can_access_realm_session_topic(text) from public,anon;
grant execute on function private.is_realm_session_member(uuid),private.can_access_realm_session_topic(text) to authenticated,service_role;
create table if not exists public.session_messages (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references private.realm_sessions(id) on delete cascade,
 author_id uuid not null references public.profiles(id) on delete restrict,
 content text not null check(char_length(btrim(content)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists session_messages_recent_idx on public.session_messages(session_id,created_at desc);
alter table public.session_messages enable row level security;
revoke all on public.session_messages from public,anon;
grant select,insert on public.session_messages to authenticated;
grant all on public.session_messages to service_role;
create policy "session members read session messages" on public.session_messages for select to authenticated using((select private.is_realm_session_member(session_id)));
create policy "players and GMs send session messages" on public.session_messages for insert to authenticated with check(
 author_id=(select auth.uid()) and exists(
  select 1 from private.realm_session_members sm
  join private.realm_sessions s on s.id=sm.session_id
  join public.campaign_members cm on cm.campaign_id=s.campaign_id and cm.user_id=sm.user_id
  where sm.session_id=session_messages.session_id and sm.user_id=(select auth.uid()) and s.status='active' and cm.role in('gm','player')
 )
);
create or replace function public.create_realm_session(p_user_id uuid,p_campaign_id uuid,p_pin text) returns uuid language plpgsql security definer set search_path='' as $$
declare new_session_id uuid;
begin
 if p_user_id is null or p_campaign_id is null or p_pin !~ '^[A-Z0-9]{8}$' or p_pin !~ '[A-Z]' or p_pin !~ '[0-9]' then raise exception 'INVALID_SESSION_DETAILS'; end if;
 if not exists(select 1 from public.campaign_members cm where cm.campaign_id=p_campaign_id and cm.user_id=p_user_id and cm.role='gm') then raise exception 'CAMPAIGN_GM_REQUIRED'; end if;
 if exists(select 1 from private.realm_sessions s where s.campaign_id=p_campaign_id and s.status='active') then raise exception 'CAMPAIGN_SESSION_ACTIVE'; end if;
 insert into private.realm_sessions(campaign_id,created_by,pin) values(p_campaign_id,p_user_id,p_pin) returning id into new_session_id;
 insert into private.realm_session_members(session_id,user_id) values(new_session_id,p_user_id);
 return new_session_id;
exception when unique_violation then
 if exists(select 1 from private.realm_sessions s where s.campaign_id=p_campaign_id and s.status='active') then raise exception 'CAMPAIGN_SESSION_ACTIVE'; end if;
 raise exception 'SESSION_PIN_TAKEN';
end;
$$;
create or replace function public.join_realm_session(p_user_id uuid,p_pin text,p_role text) returns uuid language plpgsql security definer set search_path='' as $$
declare target_session private.realm_sessions%rowtype; existing_role text;
begin
 if p_user_id is null or p_pin !~ '^[A-Z0-9]{8}$' or p_role not in('player','observer') then raise exception 'INVALID_SESSION_DETAILS'; end if;
 select * into target_session from private.realm_sessions where pin=p_pin and status='active' for update;
 if not found then raise exception 'SESSION_NOT_FOUND'; end if;
 if exists(select 1 from private.realm_session_members sm where sm.session_id=target_session.id and sm.user_id=p_user_id) then return target_session.id; end if;
 select cm.role into existing_role from public.campaign_members cm where cm.campaign_id=target_session.campaign_id and cm.user_id=p_user_id;
 if existing_role is null then insert into public.campaign_members(campaign_id,user_id,role) values(target_session.campaign_id,p_user_id,p_role); end if;
 insert into private.realm_session_members(session_id,user_id) values(target_session.id,p_user_id);
 return target_session.id;
end;
$$;
create or replace function public.get_realm_session(p_user_id uuid,p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare session_row private.realm_sessions%rowtype; campaign_title text; members_json jsonb;
begin
 select s.* into session_row from private.realm_sessions s join private.realm_session_members sm on sm.session_id=s.id where s.id=p_session_id and sm.user_id=p_user_id;
 if not found then raise exception 'SESSION_ACCESS_DENIED'; end if;
 select c.title into campaign_title from public.campaigns c where c.id=session_row.campaign_id;
 select coalesce(jsonb_agg(jsonb_build_object('userId',sm.user_id,'displayName',p.display_name,'role',cm.role,'joinedAt',sm.joined_at) order by sm.joined_at),'[]'::jsonb)
 into members_json from private.realm_session_members sm join public.profiles p on p.id=sm.user_id join public.campaign_members cm on cm.campaign_id=session_row.campaign_id and cm.user_id=sm.user_id where sm.session_id=p_session_id;
 return jsonb_build_object('id',session_row.id,'campaignId',session_row.campaign_id,'campaignTitle',campaign_title,'createdBy',session_row.created_by,'status',session_row.status,'pin',case when session_row.created_by=p_user_id then session_row.pin else null end,'members',members_json);
end;
$$;
create or replace function public.leave_realm_session(p_user_id uuid,p_session_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin delete from private.realm_session_members where session_id=p_session_id and user_id=p_user_id; return found; end;
$$;
create or replace function public.end_realm_session(p_user_id uuid,p_session_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin update private.realm_sessions set status='ended',ended_at=now() where id=p_session_id and created_by=p_user_id and status='active'; return found; end;
$$;
create or replace function public.check_realm_session_pin_attempt(p_device_fingerprint text,p_ip_fingerprint text,p_failed boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare device_attempts integer; ip_attempts integer;
begin
 if p_device_fingerprint !~ '^[0-9a-f]{64}$' or p_ip_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_RATE_LIMIT_FINGERPRINT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(p_device_fingerprint,p_ip_fingerprint),0));
 if p_device_fingerprint<>p_ip_fingerprint then perform pg_advisory_xact_lock(hashtextextended(greatest(p_device_fingerprint,p_ip_fingerprint),0)); end if;
 delete from private.realm_session_pin_attempts where attempted_at<now()-interval '1 day';
 select count(*) filter(where fingerprint=p_device_fingerprint)::integer,count(*) filter(where fingerprint=p_ip_fingerprint)::integer into device_attempts,ip_attempts from private.realm_session_pin_attempts where fingerprint in(p_device_fingerprint,p_ip_fingerprint) and attempted_at>now()-interval '15 minutes';
 if device_attempts>=5 or ip_attempts>=5 then return false; end if;
 if p_failed then insert into private.realm_session_pin_attempts(fingerprint) values(p_device_fingerprint) union all select p_ip_fingerprint where p_ip_fingerprint<>p_device_fingerprint; end if;
 return true;
end;
$$;
revoke all on function public.create_realm_session(uuid,uuid,text),public.join_realm_session(uuid,text,text),public.get_realm_session(uuid,uuid),public.leave_realm_session(uuid,uuid),public.end_realm_session(uuid,uuid),public.check_realm_session_pin_attempt(text,text,boolean) from public,anon,authenticated;
grant execute on function public.create_realm_session(uuid,uuid,text),public.join_realm_session(uuid,text,text),public.get_realm_session(uuid,uuid),public.leave_realm_session(uuid,uuid),public.end_realm_session(uuid,uuid),public.check_realm_session_pin_attempt(text,text,boolean) to service_role;
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='session_messages') then alter publication supabase_realtime add table public.session_messages; end if; end $$;
create policy "realm session members can read realtime messages" on realtime.messages for select to authenticated using(realtime.messages.extension in('broadcast','presence') and (select private.can_access_realm_session_topic(realtime.topic())));
create policy "realm session members can send realtime messages" on realtime.messages for insert to authenticated with check(realtime.messages.extension in('broadcast','presence') and (select private.can_access_realm_session_topic(realtime.topic())));
