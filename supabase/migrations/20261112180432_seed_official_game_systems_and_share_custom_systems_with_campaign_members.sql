-- Seed the built-in REALMS game systems and expose custom systems to campaign members.
drop policy if exists "users read available game systems" on public.game_systems;

create policy "users read available game systems"
  on public.game_systems for select to authenticated
  using (
    is_official
    or created_by = (select auth.uid())
    or exists (
      select 1
      from public.campaigns c
      where c.game_system_id = game_systems.id
        and (select private.is_campaign_member(c.id))
    )
  );

insert into public.game_systems
  (slug, name, description, is_official, created_by, character_schema, dice_rules)
values
  (
    'dnd-5e',
    'Dungeons & Dragons 5ª edição',
    'RPG de fantasia medieval com classes, níveis, atributos e uma ampla variedade de cenários.',
    true,
    null,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'tormenta20',
    'Tormenta20',
    'RPG brasileiro de fantasia heroica ambientado no mundo de Arton.',
    true,
    null,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'ordem-paranormal',
    'Ordem Paranormal RPG',
    'RPG de investigação e horror sobrenatural ambientado em um mundo contemporâneo.',
    true,
    null,
    '{}'::jsonb,
    '{}'::jsonb
  )
on conflict (slug) do nothing;

create index if not exists game_systems_creator_idx
  on public.game_systems (created_by, name)
  where created_by is not null;

create index if not exists campaigns_game_system_idx
  on public.campaigns (game_system_id);
