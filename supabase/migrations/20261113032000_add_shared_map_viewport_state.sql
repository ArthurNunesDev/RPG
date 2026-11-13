alter table public.session_map_states
  add column if not exists view_zoom numeric(5,3) not null default 1 check (view_zoom between 0.5 and 3),
  add column if not exists view_offset_x numeric(10,2) not null default 0,
  add column if not exists view_offset_y numeric(10,2) not null default 0;

-- Only the GM may update the viewport and session map lifecycle fields.
revoke update on public.session_map_states from authenticated;
grant update (active_map_id, is_open, updated_by, updated_at, view_zoom, view_offset_x, view_offset_y)
  on public.session_map_states to authenticated;

-- Keep request identity and ownership immutable for clients; GMs can only decide.
revoke update on public.session_map_access_requests from authenticated;
grant update (status, decided_at, decided_by) on public.session_map_access_requests to authenticated;
