-- Hobzerve Stage 4 — email (Decisions 35, 55, 57, 58, 60, 61, 90, 113).
-- In-app notifications stay the source of truth. Email is a second channel: important events go out right away
-- (grouped per person per dispatch run), automatic reports go out with the PDF attached, and everything else is
-- summarised in one daily digest at 20:00 Cairo. A failed send is recorded and never retried automatically.
--
-- Sending happens in the app's /api/email/dispatch route (Google Workspace SMTP). The database never holds SMTP
-- credentials. The route authenticates to the database with a shared dispatch secret instead of a service-role key.

-- ═════════════ Configuration (app schema is not exposed through the API) ═════════════
create table app.email_config (
  key text primary key check (key in ('dispatch_url', 'dispatch_secret')),
  value text not null
);
revoke all on app.email_config from public, anon, authenticated;

-- Run once from the SQL editor after deploying (see docs/RUNBOOK.md):
--   select app.configure_email('https://<your-app>/api/email/dispatch', '<long random secret>');
-- Pass nulls to switch email off.
create or replace function app.configure_email(p_dispatch_url text, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_dispatch_url is null or p_secret is null then
    delete from app.email_config;
    return;
  end if;
  if p_dispatch_url !~ '^https?://' then perform app.raise('HZ422', 'The dispatch URL must start with http(s)://'); end if;
  if char_length(p_secret) < 32 then perform app.raise('HZ422', 'Use a dispatch secret of at least 32 characters.'); end if;
  insert into app.email_config values ('dispatch_url', p_dispatch_url), ('dispatch_secret', p_secret)
  on conflict (key) do update set value = excluded.value;
end $$;
revoke all on function app.configure_email(text, text) from public, anon, authenticated;

create or replace function app.email_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.email_config where key = 'dispatch_secret')
$$;

create or replace function app.check_dispatch_secret(p_secret text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select value into v from app.email_config where key = 'dispatch_secret';
  if v is null or p_secret is null or v <> p_secret then
    perform app.raise('HZ403', 'Invalid dispatch secret.');
  end if;
end $$;

-- Personal channel preferences (Decision 55); all on by default. Critical in-app alerts are unaffected.
create or replace function app.email_pref(p_user uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (preferences -> 'email' ->> p_key)::boolean from public.profiles where id = p_user), true)
$$;

-- ═════════════ Delivery queue ═════════════
alter table public.email_deliveries drop constraint if exists email_deliveries_status_check;
alter table public.email_deliveries
  add column recipient_id uuid references public.profiles (id) on delete cascade,
  add column kind text check (kind in ('immediate', 'report', 'digest')),
  add column report_id uuid references public.report_snapshots (id) on delete set null,
  add column digest_date date,
  add column notification_ids uuid[] not null default '{}',
  add column sent_at timestamptz,
  add column message_id text,
  add constraint email_deliveries_status_check check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
alter table public.email_deliveries alter column recipient_id set not null, alter column kind set not null;
create unique index email_digest_once_per_day on public.email_deliveries (recipient_id, digest_date) where kind = 'digest';
create index email_deliveries_pending on public.email_deliveries (status, created_at) where status in ('pending', 'sending');
create index on public.email_deliveries (recipient_id, created_at desc);

create policy email_deliveries_read_own on public.email_deliveries for select to authenticated
  using (recipient_id = auth.uid());
grant select on public.email_deliveries to authenticated;

-- Queue an email for each new notification that warrants one. Only while email is configured, so switching email
-- on later doesn't flood anyone with a backlog.
create or replace function app.queue_email_for_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_report uuid;
begin
  if not app.email_enabled() then return new; end if;
  if (select coalesce(email, '') from public.profiles where id = new.recipient_id) = '' then return new; end if;

  if new.event_type = 'report.generated' then
    select entity_id into v_report from public.audit_events where id = new.audit_event_id;
    -- Only recent periods: a first catch-up close over many past weeks must not send a pile of old reports.
    if app.email_pref(new.recipient_id, 'reports') and exists (
      select 1 from public.report_snapshots s
      where s.id = v_report and s.period_end >= app.local_date(new.workspace_id, now()) - 14
    ) then
      insert into public.email_deliveries (workspace_id, notification_id, recipient_id, kind, report_id, status, notification_ids)
      values (new.workspace_id, new.id, new.recipient_id, 'report', v_report, 'pending', array[new.id]);
    end if;
  elsif new.critical and app.email_pref(new.recipient_id, 'immediate') then
    insert into public.email_deliveries (workspace_id, notification_id, recipient_id, kind, status, notification_ids)
    values (new.workspace_id, new.id, new.recipient_id, 'immediate', 'pending', array[new.id]);
  end if;
  return new;
end $$;

create trigger notifications_queue_email after insert on public.notifications
  for each row execute function app.queue_email_for_notification();

-- Daily digest (Decision 57): once per person per local day, at or after the digest time (default 20:00 Cairo).
-- Covers notifications since the previous digest that were not already emailed. Nothing new → recorded as skipped.
create or replace function app.enqueue_digests() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
  m record;
  v_today date;
  v_since timestamptz;
  v_ids uuid[];
  v_count integer := 0;
  v_time time;
begin
  if not app.email_enabled() then return 0; end if;
  for w in select * from public.workspaces loop
    v_today := app.local_date(w.id, now());
    v_time := coalesce((w.settings -> 'email' ->> 'digest_time')::time, '20:00');
    continue when app.local_ts(w.id, v_today, v_time) > now();
    for m in
      select wm.user_id from public.workspace_members wm join public.profiles p on p.id = wm.user_id
      where wm.workspace_id = w.id and (wm.active_to is null or wm.active_to >= v_today) and coalesce(p.email, '') <> ''
    loop
      continue when exists (select 1 from public.email_deliveries d where d.recipient_id = m.user_id and d.kind = 'digest' and d.digest_date = v_today);
      select coalesce(max(d.created_at), now() - interval '24 hours') into v_since
      from public.email_deliveries d where d.recipient_id = m.user_id and d.kind = 'digest';
      select coalesce(array_agg(n.id order by n.created_at), '{}') into v_ids
      from public.notifications n
      where n.recipient_id = m.user_id and n.workspace_id = w.id and n.created_at > v_since
        and not exists (select 1 from public.email_deliveries d where d.recipient_id = m.user_id and n.id = any (d.notification_ids));
      insert into public.email_deliveries (workspace_id, recipient_id, kind, digest_date, notification_ids, status)
      values (w.id, m.user_id, 'digest', v_today, v_ids,
              case when cardinality(v_ids) = 0 or not app.email_pref(m.user_id, 'digest') then 'skipped' else 'pending' end)
      on conflict (recipient_id, digest_date) where kind = 'digest' do nothing;
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

-- Every minute (pg_cron): digests, time out stuck sends (no retry), and wake the dispatcher if anything is pending.
create or replace function app.email_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_digests integer;
  v_timed_out integer;
  v_pending integer;
  v_url text;
  v_secret text;
  v_called boolean := false;
begin
  v_digests := app.enqueue_digests();
  update public.email_deliveries set status = 'failed', error = 'Timed out while sending; not retried automatically.'
  where status = 'sending' and attempted_at < now() - interval '10 minutes';
  get diagnostics v_timed_out = row_count;
  select count(*) into v_pending from public.email_deliveries where status = 'pending';
  select value into v_url from app.email_config where key = 'dispatch_url';
  select value into v_secret from app.email_config where key = 'dispatch_secret';
  if v_pending > 0 and v_url is not null and exists (select 1 from pg_extension where extname = 'pg_net') then
    execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := $2, timeout_milliseconds := 30000)'
      using v_url, jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
    v_called := true;
  end if;
  return jsonb_build_object('digests', v_digests, 'timed_out', v_timed_out, 'pending', v_pending, 'dispatch_called', v_called);
end $$;

-- ═════════════ Dispatcher RPCs (called by the app server with the shared secret) ═════════════
-- Claims pending deliveries and returns ready-to-send messages. Immediate notices for the same person are grouped
-- into one email (Decision 60).
create or replace function public.email_claim(p_secret text, p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  r record;
  v_batch uuid;
  v_ids uuid[];
  v_items jsonb;
begin
  perform app.check_dispatch_secret(p_secret);

  -- Immediate: one message per recipient.
  for r in
    select d.recipient_id, array_agg(d.id order by d.created_at) as ids
    from (select * from public.email_deliveries where status = 'pending' and kind = 'immediate'
          order by created_at limit greatest(1, least(p_limit, 200)) for update skip locked) d
    group by d.recipient_id
  loop
    v_batch := gen_random_uuid();
    update public.email_deliveries set status = 'sending', attempted_at = now(), batch_id = v_batch where id = any (r.ids);
    select coalesce(jsonb_agg(jsonb_build_object('title', n.title, 'body', n.body, 'link', n.link, 'at', n.created_at) order by n.created_at), '[]'::jsonb)
      into v_items
    from public.email_deliveries d join public.notifications n on n.id = d.notification_id where d.id = any (r.ids);
    v_out := v_out || jsonb_build_object('kind', 'immediate', 'delivery_ids', to_jsonb(r.ids), 'items', v_items,
      'to', (select jsonb_build_object('email', p.email, 'name', p.display_name) from public.profiles p where p.id = r.recipient_id));
  end loop;

  -- Reports and digests: one message each.
  for r in
    select * from public.email_deliveries where status = 'pending' and kind in ('report', 'digest')
    order by created_at limit greatest(1, least(p_limit, 50)) for update skip locked
  loop
    update public.email_deliveries set status = 'sending', attempted_at = now(), batch_id = gen_random_uuid() where id = r.id;
    select coalesce(jsonb_agg(jsonb_build_object('title', n.title, 'body', n.body, 'link', n.link, 'at', n.created_at, 'read', n.read_at is not null)
                    order by n.created_at), '[]'::jsonb)
      into v_items
    from public.notifications n where n.id = any (r.notification_ids);
    v_out := v_out || jsonb_build_object(
      'kind', r.kind, 'delivery_ids', jsonb_build_array(r.id), 'items', v_items, 'digest_date', r.digest_date,
      'to', (select jsonb_build_object('email', p.email, 'name', p.display_name) from public.profiles p where p.id = r.recipient_id),
      'report', case when r.kind = 'report' and r.report_id is not null then
        (select to_jsonb(s) || jsonb_build_object('subject_name', app.display_name(s.subject_user_id)) from public.report_snapshots s where s.id = r.report_id) end);
  end loop;
  return v_out;
end $$;

-- Records the outcome of each message. Failures are final (Decision 58): no automatic retry.
create or replace function public.email_report(p_secret text, p_results jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_count integer := 0;
  v_n integer;
begin
  perform app.check_dispatch_secret(p_secret);
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    update public.email_deliveries set
      status = case when (r ->> 'ok')::boolean then 'sent' else 'failed' end,
      sent_at = case when (r ->> 'ok')::boolean then now() end,
      message_id = left(r ->> 'message_id', 300),
      error = case when (r ->> 'ok')::boolean then null else left(coalesce(r ->> 'error', 'Unknown error'), 1000) end
    where status = 'sending' and id in (select (jsonb_array_elements_text(r -> 'delivery_ids'))::uuid);
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end $$;

-- ═════════════ Preferences and status for the app ═════════════
create or replace function public.set_email_preferences(p_immediate boolean, p_digest boolean, p_reports boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid();
begin
  update public.profiles
  set preferences = jsonb_set(preferences, '{email}', jsonb_build_object('immediate', p_immediate, 'digest', p_digest, 'reports', p_reports))
  where id = v_uid;
end $$;

create or replace function public.set_digest_time(p_workspace uuid, p_time time) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  w public.workspaces;
begin
  perform app.require_manager(p_workspace, v_uid);
  if p_time is null then perform app.raise('HZ422', 'Choose a time.'); end if;
  select * into w from public.workspaces where id = p_workspace for update;
  update public.workspaces
  set settings = jsonb_set(settings, '{email}', coalesce(settings -> 'email', '{}'::jsonb) || jsonb_build_object('digest_time', to_char(p_time, 'HH24:MI')))
  where id = p_workspace;
  perform app.emit(p_workspace, v_uid, null, 'workspace', p_workspace, null, 'settings.email',
    format('%s set the daily email digest to %s (Cairo)', app.display_name(v_uid), to_char(p_time, 'HH24:MI')),
    w.settings -> 'email', null, '{}'::jsonb, false, '/settings');
end $$;

create or replace function public.email_status(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid();
begin
  if not app.is_member(p_workspace) then perform app.raise('HZ403', 'You are not a member of this workspace.'); end if;
  return jsonb_build_object(
    'configured', app.email_enabled(),
    'digest_time', coalesce((select settings -> 'email' ->> 'digest_time' from public.workspaces where id = p_workspace), '20:00'),
    'preferences', jsonb_build_object('immediate', app.email_pref(v_uid, 'immediate'), 'digest', app.email_pref(v_uid, 'digest'), 'reports', app.email_pref(v_uid, 'reports')),
    'email', (select email from public.profiles where id = v_uid));
end $$;

revoke all on all functions in schema public from public, anon;
grant execute on function public.email_claim(text, integer), public.email_report(text, jsonb) to anon, authenticated;
grant execute on function
  public.set_email_preferences(boolean, boolean, boolean),
  public.set_digest_time(uuid, time),
  public.email_status(uuid)
to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hobzerve-email-tick', '* * * * *', 'select app.email_tick()');
  end if;
end $$;
