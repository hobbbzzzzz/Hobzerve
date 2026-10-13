-- Hobzerve Stage 4 — privilege hardening (A35).
-- Functions created in the app schema after Stage 1 inherited PostgreSQL's default EXECUTE-to-PUBLIC grant. The app
-- schema isn't exposed through the API, so nothing was reachable, but helpers like app.close_week should not be
-- callable by signed-in users even in principle. Only the helpers used inside RLS policies stay executable.

alter default privileges in schema app revoke execute on functions from public;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function
  app.is_member(uuid),
  app.is_manager(uuid),
  app.can_view_user_work(uuid, uuid),
  app.can_view_task(uuid)
to authenticated;

-- anon needs nothing in app; the two dispatcher RPCs in public check the shared secret themselves.
revoke usage on schema app from anon;
