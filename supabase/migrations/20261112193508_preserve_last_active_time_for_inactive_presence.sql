create or replace function public.set_my_presence(p_status text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_status not in ('online','inactive','offline') then raise exception 'INVALID_PRESENCE_STATUS'; end if;
  insert into public.user_presence(user_id,status,last_seen_at,updated_at)
  values((select auth.uid()),p_status,now(),now())
  on conflict(user_id) do update set
    status=excluded.status,
    last_seen_at=case when p_status='online' then now() else public.user_presence.last_seen_at end,
    updated_at=now();
end;
$$;