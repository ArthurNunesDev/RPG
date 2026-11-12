create or replace function private.validate_campaign_playback_track()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.track_id is not null and not exists (
    select 1 from public.campaign_tracks t
    where t.id = new.track_id and t.campaign_id = new.campaign_id
  ) then
    raise exception 'PLAYBACK_TRACK_CAMPAIGN_MISMATCH';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_campaign_playback_track() from public,anon,authenticated;
drop trigger if exists campaign_playback_validate_track on public.campaign_playback;
create trigger campaign_playback_validate_track
before insert or update of campaign_id,track_id on public.campaign_playback
for each row execute function private.validate_campaign_playback_track();