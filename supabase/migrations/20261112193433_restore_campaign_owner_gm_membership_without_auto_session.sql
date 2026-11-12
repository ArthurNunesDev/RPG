drop trigger if exists add_campaign_owner_as_gm on public.campaigns;
create trigger add_campaign_owner_as_gm after insert on public.campaigns
for each row execute function private.add_campaign_owner_as_gm();