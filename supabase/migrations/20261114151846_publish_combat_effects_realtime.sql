do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'combat_effects'
     ) then
    alter publication supabase_realtime add table public.combat_effects;
  end if;
end
$$;
