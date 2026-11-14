-- Keep the friend-code lookup RPC invoker-scoped in the exposed public schema.
-- The lookup implementation stays in the non-exposed private schema.
create or replace function private.find_profile_id_by_friend_code(p_friend_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.user_id
  from public.profile_private_data d
  where auth.uid() is not null
    and p_friend_code ~ '^[A-Za-z0-9]{8}$'
    and d.friend_code = upper(btrim(p_friend_code))
  limit 1;
$$;

revoke all on function private.find_profile_id_by_friend_code(text) from public, anon;
grant execute on function private.find_profile_id_by_friend_code(text) to authenticated;

create or replace function public.find_profile_id_by_friend_code(p_friend_code text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select private.find_profile_id_by_friend_code(p_friend_code);
$$;

revoke all on function public.find_profile_id_by_friend_code(text) from public, anon;
grant execute on function public.find_profile_id_by_friend_code(text) to authenticated;
