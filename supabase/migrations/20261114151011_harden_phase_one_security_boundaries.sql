-- Phase 1 security hardening for REALMS.
-- Preserve existing profile data while moving private fields behind their own RLS boundary.

create table if not exists public.profile_private_data (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  friend_code text not null unique,
  preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profile_private_data (user_id, friend_code, preferences)
select p.id, p.friend_code, p.preferences
from public.profiles p
where p.friend_code is not null
on conflict (user_id) do update
set friend_code = excluded.friend_code,
    preferences = excluded.preferences;

create or replace function private.generate_friend_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  candidate text;
  i integer;
begin
  for attempt in 1..100 loop
    bytes := extensions.gen_random_bytes(8);
    candidate := '';
    for i in 0..7 loop
      candidate := candidate || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    end loop;
    if not exists (
      select 1 from public.profile_private_data d where d.friend_code = candidate
    ) then
      return candidate;
    end if;
  end loop;
  raise exception 'FRIEND_CODE_GENERATION_FAILED';
end;
$$;

create or replace function private.create_profile_private_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profile_private_data (user_id, friend_code, preferences)
  values (new.id, new.friend_code, coalesce(new.preferences, '{}'::jsonb))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_create_private_data on public.profiles;
create trigger profiles_create_private_data
  after insert on public.profiles
  for each row execute function private.create_profile_private_data();

alter table public.profile_private_data enable row level security;
revoke all on public.profile_private_data from public, anon, authenticated;
grant select (user_id, friend_code, preferences)
  on public.profile_private_data to authenticated;
grant update (preferences)
  on public.profile_private_data to authenticated;

drop policy if exists "users read their private profile data" on public.profile_private_data;
create policy "users read their private profile data"
  on public.profile_private_data for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users update their private profile preferences" on public.profile_private_data;
create policy "users update their private profile preferences"
  on public.profile_private_data for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.find_profile_id_by_friend_code(p_friend_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.user_id
  from public.profile_private_data d
  where auth.uid() is not null
    and d.friend_code = upper(btrim(p_friend_code))
  limit 1;
$$;

revoke all on function public.find_profile_id_by_friend_code(text) from public, anon;
grant execute on function public.find_profile_id_by_friend_code(text) to authenticated;
revoke all on function private.generate_friend_code() from public, anon, authenticated;

-- Only public identity fields remain readable through profiles.
revoke all on public.profiles from authenticated;
grant select (id, username, display_name, avatar_url, preferred_role)
  on public.profiles to authenticated;
grant update (username, avatar_url, preferred_role)
  on public.profiles to authenticated;

-- A recipient can only change the response state, never the relationship endpoints.
revoke insert, update on public.friendships from authenticated;
grant insert (requester_id, addressee_id) on public.friendships to authenticated;
grant update (status, updated_at) on public.friendships to authenticated;

-- Storage is private and readable only when its corresponding resource is visible.
drop policy if exists "campaign members read campaign assets" on storage.objects;
create policy "campaign members read campaign assets"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'campaign-assets'
    and (
      exists (
        select 1
        from public.campaign_maps m
        where m.storage_path = objects.name
          and (
            (select private.is_campaign_gm(m.campaign_id))
            or (
              m.is_visible
              and (select private.is_campaign_member(m.campaign_id))
              and exists (
                select 1
                from public.session_map_access_requests r
                join public.session_map_states st
                  on st.session_id = r.session_id
                 and st.active_map_id = r.map_id
                where r.map_id = m.id
                  and r.user_id = (select auth.uid())
                  and r.status = 'approved'
                  and st.is_open
                  and (select private.is_realm_session_member(r.session_id))
              )
            )
          )
      )
      or exists (
        select 1
        from public.campaign_tracks t
        where t.storage_path = objects.name
          and (
            (select private.is_campaign_gm(t.campaign_id))
            or (
              t.is_visible
              and (select private.is_campaign_member(t.campaign_id))
            )
          )
      )
    )
  );

-- Relationship helpers return only booleans and execute with a fixed search path.
create or replace function private.session_matches_campaign(
  p_session_id uuid,
  p_campaign_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.realm_sessions s
    where s.id = p_session_id
      and s.campaign_id = p_campaign_id
  );
$$;

create or replace function private.combatant_matches_encounter(
  p_encounter_id uuid,
  p_character_id uuid,
  p_owner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.combat_encounters e
    join public.characters c
      on c.id = p_character_id
     and c.owner_id = p_owner_id
    where e.id = p_encounter_id
      and (select private.session_matches_campaign(e.session_id, e.campaign_id))
      and (
        (
          c.campaign_id = e.campaign_id
          and c.campaign_approval_status = 'approved'
        )
        or (
          c.campaign_id is null
          and exists (
            select 1
            from public.campaign_members cm
            where cm.campaign_id = e.campaign_id
              and cm.user_id = c.owner_id
          )
        )
      )
  );
$$;

revoke all on function private.session_matches_campaign(uuid, uuid) from public, anon;
revoke all on function private.combatant_matches_encounter(uuid, uuid, uuid) from public, anon;
grant execute on function private.session_matches_campaign(uuid, uuid) to authenticated;
grant execute on function private.combatant_matches_encounter(uuid, uuid, uuid) to authenticated;

-- Map tokens must use a session, map, and approved character from one campaign.
drop policy if exists "GMs add and remove map character tokens" on public.session_map_tokens;
create policy "GMs add and remove map character tokens"
  on public.session_map_tokens for insert to authenticated
  with check (
    (select private.is_campaign_gm(session_map_tokens.campaign_id))
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and (select private.session_matches_campaign(session_map_tokens.session_id, session_map_tokens.campaign_id))
    and exists (
      select 1 from public.campaign_maps m
      where m.id = session_map_tokens.map_id
        and m.campaign_id = session_map_tokens.campaign_id
    )
    and exists (
      select 1 from public.characters c
      where c.id = session_map_tokens.character_id
        and c.campaign_id = session_map_tokens.campaign_id
        and c.campaign_approval_status = 'approved'
    )
  );

-- Combat encounter CRUD is split so its campaign/session identity cannot be rewritten.
drop policy if exists "session members read combat encounters" on public.combat_encounters;
create policy "session members read matching combat encounters"
  on public.combat_encounters for select to authenticated
  using (
    (select private.is_realm_session_member(session_id))
    and (select private.session_matches_campaign(session_id, campaign_id))
  );

drop policy if exists "game masters manage combat encounters" on public.combat_encounters;
create policy "game masters create matching combat encounters"
  on public.combat_encounters for insert to authenticated
  with check (
    started_by = (select auth.uid())
    and (select private.is_campaign_gm(campaign_id))
    and (select private.session_matches_campaign(session_id, campaign_id))
  );

create policy "game masters update matching combat encounters"
  on public.combat_encounters for update to authenticated
  using (
    (select private.is_campaign_gm(campaign_id))
    and (select private.session_matches_campaign(session_id, campaign_id))
  )
  with check (
    (select private.is_campaign_gm(campaign_id))
    and (select private.session_matches_campaign(session_id, campaign_id))
  );

create policy "game masters delete matching combat encounters"
  on public.combat_encounters for delete to authenticated
  using (
    (select private.is_campaign_gm(campaign_id))
    and (select private.session_matches_campaign(session_id, campaign_id))
  );

revoke update on public.combat_encounters from authenticated;
grant update (game_system, status, round_number, turn_index, ended_at, updated_at, turns_paused, current_turn_note)
  on public.combat_encounters to authenticated;

-- Combatants can only reference an approved campaign character or a member's personal character.
drop policy if exists "session members read combatants" on public.combatants;
create policy "session members read matching combatants"
  on public.combatants for select to authenticated
  using (
    exists (
      select 1
      from public.combat_encounters e
      where e.id = encounter_id
        and (select private.is_realm_session_member(e.session_id))
        and (select private.combatant_matches_encounter(combatants.encounter_id, combatants.character_id, combatants.owner_id))
    )
  );

drop policy if exists "game masters manage combatants" on public.combatants;
create policy "game masters manage matching combatants"
  on public.combatants for all to authenticated
  using (
    exists (
      select 1
      from public.combat_encounters e
      where e.id = encounter_id
        and (select private.is_campaign_gm(e.campaign_id))
        and (select private.combatant_matches_encounter(combatants.encounter_id, combatants.character_id, combatants.owner_id))
    )
  )
  with check (
    exists (
      select 1
      from public.combat_encounters e
      where e.id = encounter_id
        and (select private.is_campaign_gm(e.campaign_id))
        and (select private.combatant_matches_encounter(combatants.encounter_id, combatants.character_id, combatants.owner_id))
    )
  );

revoke update on public.combatants from authenticated;
grant update (
  character_name, side, initiative, initiative_rolls, is_surprised, is_active,
  current_hp, max_hp, current_pe, max_pe, current_pd, max_pd, actions_used,
  conditions, sort_order, turn_order, turn_blocked, turn_control, defense, updated_at
) on public.combatants to authenticated;

-- Combatant sheet snapshots must agree with the actual combatant and its owner.
drop policy if exists "owners and GMs read combatant sheets" on public.combatant_sheets;
create policy "owners and GMs read matching combatant sheets"
  on public.combatant_sheets for select to authenticated
  using (
    exists (
      select 1
      from public.combatants cb
      join public.combat_encounters e on e.id = cb.encounter_id
      where cb.id = combatant_sheets.combatant_id
        and cb.character_id = combatant_sheets.character_id
        and cb.owner_id = combatant_sheets.owner_id
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
        and (
          cb.owner_id = (select auth.uid())
          or (select private.is_campaign_gm(e.campaign_id))
        )
    )
  );

drop policy if exists "GMs manage combatant sheets" on public.combatant_sheets;
create policy "GMs manage matching combatant sheets"
  on public.combatant_sheets for all to authenticated
  using (
    exists (
      select 1
      from public.combatants cb
      join public.combat_encounters e on e.id = cb.encounter_id
      where cb.id = combatant_sheets.combatant_id
        and cb.character_id = combatant_sheets.character_id
        and cb.owner_id = combatant_sheets.owner_id
        and (select private.is_campaign_gm(e.campaign_id))
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
    )
  )
  with check (
    exists (
      select 1
      from public.combatants cb
      join public.combat_encounters e on e.id = cb.encounter_id
      where cb.id = combatant_sheets.combatant_id
        and cb.character_id = combatant_sheets.character_id
        and cb.owner_id = combatant_sheets.owner_id
        and (select private.is_campaign_gm(e.campaign_id))
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
    )
  );

revoke update on public.combatant_sheets from authenticated;
grant update (sheet_snapshot, updated_at) on public.combatant_sheets to authenticated;

-- Action requests must point only to combatants from the same encounter.
create policy "combat requests preserve encounter relationships"
  on public.combat_action_requests as restrictive
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.combat_encounters e
      join public.combatants actor
        on actor.encounter_id = e.id
       and actor.character_id = combat_action_requests.actor_character_id
      where e.id = combat_action_requests.encounter_id
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
        and (
          combat_action_requests.target_character_id is null
          or exists (
            select 1
            from public.combatants target
            where target.encounter_id = e.id
              and target.character_id = combat_action_requests.target_character_id
          )
        )
    )
  );

create policy "resolved combat requests preserve encounter relationships"
  on public.combat_action_requests as restrictive
  for update to authenticated
  using (true)
  with check (
    exists (
      select 1
      from public.combat_encounters e
      join public.combatants actor
        on actor.encounter_id = e.id
       and actor.character_id = combat_action_requests.actor_character_id
      where e.id = combat_action_requests.encounter_id
        and (select private.is_campaign_gm(e.campaign_id))
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
        and (
          combat_action_requests.target_character_id is null
          or exists (
            select 1
            from public.combatants target
            where target.encounter_id = e.id
              and target.character_id = combat_action_requests.target_character_id
          )
        )
    )
  );

revoke update on public.combat_action_requests from authenticated;
grant update (payload, status, resolved_by, resolved_at)
  on public.combat_action_requests to authenticated;

-- Event actor and target identifiers must belong to the referenced encounter.
create policy "combat events preserve encounter relationships"
  on public.combat_events as restrictive
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.combat_encounters e
      where e.id = combat_events.encounter_id
        and (select private.is_campaign_gm(e.campaign_id))
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
        and (
          combat_events.actor_character_id is null
          or exists (
            select 1 from public.combatants cb
            where cb.encounter_id = e.id
              and cb.character_id = combat_events.actor_character_id
          )
        )
        and (
          combat_events.target_character_id is null
          or exists (
            select 1 from public.combatants cb
            where cb.encounter_id = e.id
              and cb.character_id = combat_events.target_character_id
          )
        )
    )
  );

-- Effects must target combatants in their encounter; creators are immutable.
drop policy if exists "session members read combat effects" on public.combat_effects;
create policy "session members read matching combat effects"
  on public.combat_effects for select to authenticated
  using (
    exists (
      select 1
      from public.combat_encounters e
      join public.combatants cb
        on cb.encounter_id = e.id
       and cb.character_id = combat_effects.target_character_id
      where e.id = combat_effects.encounter_id
        and (select private.is_realm_session_member(e.session_id))
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
    )
  );

drop policy if exists "game masters manage combat effects" on public.combat_effects;
create policy "game masters create matching combat effects"
  on public.combat_effects for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.combat_encounters e
      join public.combatants cb
        on cb.encounter_id = e.id
       and cb.character_id = combat_effects.target_character_id
      where e.id = combat_effects.encounter_id
        and (select private.is_campaign_gm(e.campaign_id))
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
    )
  );

create policy "game masters update matching combat effects"
  on public.combat_effects for update to authenticated
  using (
    exists (
      select 1
      from public.combat_encounters e
      join public.combatants cb
        on cb.encounter_id = e.id
       and cb.character_id = combat_effects.target_character_id
      where e.id = combat_effects.encounter_id
        and (select private.is_campaign_gm(e.campaign_id))
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
    )
  )
  with check (
    exists (
      select 1
      from public.combat_encounters e
      join public.combatants cb
        on cb.encounter_id = e.id
       and cb.character_id = combat_effects.target_character_id
      where e.id = combat_effects.encounter_id
        and (select private.is_campaign_gm(e.campaign_id))
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
    )
  );

create policy "game masters delete matching combat effects"
  on public.combat_effects for delete to authenticated
  using (
    exists (
      select 1
      from public.combat_encounters e
      join public.combatants cb
        on cb.encounter_id = e.id
       and cb.character_id = combat_effects.target_character_id
      where e.id = combat_effects.encounter_id
        and (select private.is_campaign_gm(e.campaign_id))
        and (select private.session_matches_campaign(e.session_id, e.campaign_id))
    )
  );

revoke update on public.combat_effects from authenticated;
grant update (
  target_name, effect_name, effect_type, damage_per_round, healing_per_round,
  remaining_rounds, source_name, applied_round, updated_at
) on public.combat_effects to authenticated;
