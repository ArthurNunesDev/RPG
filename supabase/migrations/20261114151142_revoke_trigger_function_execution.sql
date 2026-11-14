-- Trigger functions are invoked by PostgreSQL triggers and must not be callable
-- directly through PostgREST by anonymous or authenticated clients.
revoke all on function private.create_profile_private_data() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.guard_character_approval() from public, anon, authenticated;
revoke all on function private.protect_character_campaign_approval() from public, anon, authenticated;
revoke all on function private.prevent_character_owner_change() from public, anon, authenticated;
revoke all on function private.set_updated_at() from public, anon, authenticated;
