create or replace function public.set_campaign_map_visibility(
  p_campaign_id uuid,
  p_map_id uuid,
  p_is_visible boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_map public.campaign_maps%rowtype;
begin
  if not (select private.is_campaign_gm(p_campaign_id)) then
    raise exception 'Apenas o mestre pode alterar a visibilidade dos mapas.';
  end if;

  select * into v_map
  from public.campaign_maps
  where id=p_map_id and campaign_id=p_campaign_id
  for update;
  if not found then raise exception 'Mapa não encontrado nesta campanha.'; end if;

  if p_is_visible then
    update public.campaign_maps
    set is_visible=false
    where campaign_id=p_campaign_id and id<>p_map_id and is_visible;

    update public.campaign_maps
    set is_visible=true
    where id=p_map_id;
  else
    update public.campaign_maps
    set is_visible=false
    where id=p_map_id;
  end if;

  update public.session_map_states
  set active_map_id=null,
      is_open=false,
      allow_player_movement=false,
      updated_by=(select auth.uid()),
      updated_at=now()
  where campaign_id=p_campaign_id
    and is_open
    and active_map_id is not null
    and (active_map_id<>p_map_id or not p_is_visible);

  return jsonb_build_object(
    'ok',true,
    'is_visible',p_is_visible,
    'message',case when p_is_visible then 'Mapa disponibilizado aos participantes.' else 'Mapa ocultado e fechado na sessão.' end
  );
end;
$$;

create or replace function public.delete_campaign_map(p_map_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_map public.campaign_maps%rowtype;
begin
  select * into v_map
  from public.campaign_maps
  where id=p_map_id
  for update;
  if not found then raise exception 'Mapa não encontrado.'; end if;
  if not (select private.is_campaign_gm(v_map.campaign_id)) then
    raise exception 'Apenas o mestre pode excluir mapas.';
  end if;

  update public.session_map_states
  set active_map_id=null,
      is_open=false,
      allow_player_movement=false,
      updated_by=(select auth.uid()),
      updated_at=now()
  where campaign_id=v_map.campaign_id
    and active_map_id=v_map.id;

  delete from public.campaign_maps where id=v_map.id;
  return jsonb_build_object('ok',true,'storage_path',v_map.storage_path);
end;
$$;

create or replace function public.delete_campaign_track(p_track_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_track public.campaign_tracks%rowtype;
begin
  select * into v_track
  from public.campaign_tracks
  where id=p_track_id
  for update;
  if not found then raise exception 'Trilha não encontrada.'; end if;
  if not (select private.is_campaign_gm(v_track.campaign_id)) then
    raise exception 'Apenas o mestre pode excluir trilhas.';
  end if;

  update public.campaign_playback
  set track_id=null,
      is_playing=false,
      position_seconds=0,
      updated_by=(select auth.uid()),
      updated_at=now()
  where campaign_id=v_track.campaign_id
    and track_id=v_track.id;

  delete from public.campaign_tracks where id=v_track.id;
  return jsonb_build_object('ok',true,'storage_path',v_track.storage_path);
end;
$$;

revoke all on function public.set_campaign_map_visibility(uuid,uuid,boolean) from public,anon;
revoke all on function public.delete_campaign_map(uuid) from public,anon;
revoke all on function public.delete_campaign_track(uuid) from public,anon;
grant execute on function public.set_campaign_map_visibility(uuid,uuid,boolean) to authenticated;
grant execute on function public.delete_campaign_map(uuid) to authenticated;
grant execute on function public.delete_campaign_track(uuid) to authenticated;
