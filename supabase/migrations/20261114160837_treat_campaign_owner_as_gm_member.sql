create or replace function private.is_campaign_gm(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = 'off'
as $function$
  select exists (
    select 1
    from public.campaigns c
    where c.id = p_campaign_id
      and c.owner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.campaign_members cm
    where cm.campaign_id = p_campaign_id
      and cm.user_id = (select auth.uid())
      and cm.role = 'gm'
  );
$function$;

create or replace function private.is_campaign_member(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = 'off'
as $function$
  select exists (
    select 1
    from public.campaigns c
    where c.id = p_campaign_id
      and c.owner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.campaign_members cm
    where cm.campaign_id = p_campaign_id
      and cm.user_id = (select auth.uid())
  );
$function$;
