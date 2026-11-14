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
    update public.campaign_maps set is_visible=false
    where campaign_id=p_campaign_id and id<>p_map_id and is_visible;
    update public.campaign_maps set is_visible=true where id=p_map_id;
  else
    update public.campaign_maps set is_visible=false where id=p_map_id;
  end if;

  update public.session_map_states
  set active_map_id=null,
      is_open=false,
      allow_player_movement=false,
      updated_by=(select auth.uid()),
      updated_at=now()
  where campaign_id=p_campaign_id
    and active_map_id is not null
    and (
      (p_is_visible and active_map_id<>p_map_id)
      or (not p_is_visible and active_map_id=p_map_id)
    );

  return jsonb_build_object(
    'ok',true,
    'is_visible',p_is_visible,
    'message',case when p_is_visible then 'Mapa disponibilizado aos participantes.' else 'Mapa ocultado e fechado na sessão.' end
  );
end;
$$;

revoke all on function public.set_campaign_map_visibility(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_campaign_map_visibility(uuid,uuid,boolean) to authenticated;
