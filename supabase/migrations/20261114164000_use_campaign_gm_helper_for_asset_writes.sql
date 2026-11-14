drop policy if exists "campaign GMs upload campaign assets" on storage.objects;
create policy "campaign GMs upload campaign assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'campaign-assets'
  and (select private.is_campaign_gm(((storage.foldername(name))[1])::uuid))
);

drop policy if exists "campaign GMs update campaign assets" on storage.objects;
create policy "campaign GMs update campaign assets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'campaign-assets'
  and (select private.is_campaign_gm(((storage.foldername(name))[1])::uuid))
)
with check (
  bucket_id = 'campaign-assets'
  and (select private.is_campaign_gm(((storage.foldername(name))[1])::uuid))
);

drop policy if exists "campaign GMs delete campaign assets" on storage.objects;
create policy "campaign GMs delete campaign assets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'campaign-assets'
  and (select private.is_campaign_gm(((storage.foldername(name))[1])::uuid))
);
