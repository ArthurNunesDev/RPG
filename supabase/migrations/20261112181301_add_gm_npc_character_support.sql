-- Add an explicit distinction between player characters and GM-controlled NPCs.
alter table public.characters
  add column if not exists character_type text not null default 'player',
  add column if not exists npc_role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.characters'::regclass
      and conname = 'characters_character_type_check'
  ) then
    alter table public.characters
      add constraint characters_character_type_check
      check (character_type in ('player', 'npc'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.characters'::regclass
      and conname = 'characters_npc_role_check'
  ) then
    alter table public.characters
      add constraint characters_npc_role_check
      check (
        (character_type = 'player' and npc_role is null)
        or (
          character_type = 'npc'
          and npc_role in ('ally', 'enemy', 'neutral')
          and campaign_id is not null
        )
      );
  end if;
end;
$$;

create index if not exists characters_campaign_type_updated_idx
  on public.characters (campaign_id, character_type, updated_at desc)
  where campaign_id is not null;

create or replace function private.prevent_character_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'CHARACTER_OWNER_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists characters_owner_immutable on public.characters;
create trigger characters_owner_immutable
  before update of owner_id on public.characters
  for each row execute function private.prevent_character_owner_change();

drop policy if exists "campaign participants create characters" on public.characters;
drop policy if exists "campaign members create characters" on public.characters;
create policy "campaign members create characters"
  on public.characters for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      (
        campaign_id is null
        and character_type = 'player'
        and npc_role is null
        and exists (
          select 1 from public.game_systems gs
          where gs.id = game_system_id
            and (gs.is_official or gs.created_by = (select auth.uid()))
        )
      )
      or (
        campaign_id is not null
        and exists (
          select 1
          from public.campaigns c
          where c.id = campaign_id
            and c.game_system_id = characters.game_system_id
        )
        and (
          (
            character_type = 'player'
            and npc_role is null
            and exists (
              select 1 from public.campaign_members cm
              where cm.campaign_id = characters.campaign_id
                and cm.user_id = (select auth.uid())
                and cm.role in ('gm', 'player')
            )
          )
          or (
            character_type = 'npc'
            and npc_role in ('ally', 'enemy', 'neutral')
            and (select private.is_campaign_gm(campaign_id))
          )
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
      and character_type = 'player'
      and npc_role is null
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
          and exists (
            select 1 from public.campaign_members cm
            where cm.campaign_id = characters.campaign_id
              and cm.user_id = (select auth.uid())
              and cm.role in ('gm', 'player')
          )
          and exists (
            select 1 from public.campaigns c
            where c.id = campaign_id
              and c.game_system_id = characters.game_system_id
          )
        )
      )
    )
    or (
      campaign_id is not null
      and (select private.is_campaign_gm(campaign_id))
      and exists (
        select 1 from public.campaigns c
        where c.id = campaign_id
          and c.game_system_id = characters.game_system_id
      )
      and (
        (character_type = 'player' and npc_role is null)
        or (character_type = 'npc' and npc_role in ('ally', 'enemy', 'neutral'))
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
