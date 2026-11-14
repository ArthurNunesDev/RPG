-- RLS does not protect TRUNCATE. Remove schema-level privileges that bypass row policies.
revoke all on table public.combat_effects from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke execute on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Prevent the same unsafe grants on future application objects created by postgres migrations.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
