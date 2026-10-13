-- Hobzerve Stage 2 — RPCs for attendance, live activity, task time, weekly payroll hours.
-- Same conventions as Stage 1: SECURITY DEFINER, empty search_path, explicit authorization, audit in-transaction.

-- ═════════════ Time helpers ═════════════
create or replace function app.ws_tz(p_workspace uuid) returns text
language sql stable security definer set search_path = '' as $$
  select timezone from public.workspaces where id = p_workspace
$$;

create or replace function app.local_date(p_workspace uuid, p_ts timestamptz) returns date
language sql stable security definer set search_path = '' as $$
  select (p_ts at time zone app.ws_tz(p_workspace))::date
$$;

create or replace function app.local_ts(p_workspace uuid, p_date date, p_time time default '00:00') returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((p_date + p_time)::timestamp at time zone app.ws_tz(p_workspace))
$$;

-- Saturday that starts the Sat–Fri business week containing p_date (Decision 33).
create or replace function app.week_start_of(p_date date) returns date
language sql immutable set search_path = '' as $$
  select p_date - ((extract(dow from p_date)::integer + 1) % 7)
$$;

-- Week bounds in the workspace timezone: Saturday 00:00 → next Saturday 00:00 (DST-safe).
create or replace function app.week_range(p_workspace uuid, p_week_start date) returns tstzrange
language sql stable security definer set search_path = '' as $$
  select tstzrange(app.local_ts(p_workspace, p_week_start), app.local_ts(p_workspace, p_week_start + 7), '[)')
$$;

create or replace function app.current_week_start(p_workspace uuid) returns date
language sql stable security definer set search_path = '' as $$
  select app.week_start_of(app.local_date(p_workspace, now()))
$$;

create or replace function app.target_settings(p_workspace uuid, p_week_start date) returns public.weekly_target_settings
language sql stable security definer set search_path = '' as $$
  select s.* from public.weekly_target_settings s
  where s.workspace_id = p_workspace and s.effective_from <= p_week_start
  order by s.effective_from desc limit 1
$$;

-- Working days (Sun–Thu by default) inside the person's membership window (Decision 110).
create or replace function app.active_working_days(p_workspace uuid, p_user uuid, p_week_start date) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from generate_series(p_week_start, p_week_start + 6, interval '1 day') g(d)
  join public.workspace_members m on m.workspace_id = p_workspace and m.user_id = p_user
  where extract(dow from g.d)::smallint = any (coalesce((app.target_settings(p_workspace, p_week_start)).working_days, '{0,1,2,3,4}'))
    and g.d::date >= m.active_from
    and (m.active_to is null or g.d::date <= m.active_to)
$$;

create or replace function app.week_target_seconds(p_workspace uuid, p_user uuid, p_week_start date) returns integer
language sql stable security definer set search_path = '' as $$
  select round(
    coalesce(s.base_target_minutes, 1200) * 60.0
    * app.active_working_days(p_workspace, p_user, p_week_start)
    / cardinality(coalesce(s.working_days, '{0,1,2,3,4}'::smallint[]))
  )::integer
  from (select (app.target_settings(p_workspace, p_week_start)).*) s
$$;

-- Union of closed, non-voided attendance intersected with a range, in seconds (guards accidental overlaps).
create or replace function app.closed_union_seconds(p_workspace uuid, p_user uuid, p_range tstzrange) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(extract(epoch from upper(r) - lower(r))), 0)::integer
  from unnest(
    (select range_agg(tstzrange(a.started_at, a.ended_at, '[)'))
     from public.attendance_sessions a
     where a.workspace_id = p_workspace and a.user_id = p_user and a.voided_at is null
       and a.ended_at is not null and tstzrange(a.started_at, a.ended_at, '[)') && p_range)
    * tstzmultirange(p_range)
  ) r
$$;

-- Live provisional seconds from open sessions within a range, up to now (Decision 39).
create or replace function app.open_session_seconds(p_workspace uuid, p_user uuid, p_range tstzrange) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(extract(epoch from upper(x) - lower(x))), 0)::integer
  from (
    select tstzrange(a.started_at, now(), '[)') * p_range as x
    from public.attendance_sessions a
    where a.workspace_id = p_workspace and a.user_id = p_user and a.voided_at is null and a.ended_at is null
      and a.started_at < now()
  ) s
  where not isempty(x)
$$;

create or replace function app.week_fingerprint(p_workspace uuid, p_user uuid, p_week_start date) returns text
language sql stable security definer set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(string_agg(
           a.id::text || '|' || a.started_at::text || '|' || coalesce(a.ended_at::text, 'open'), ';' order by a.started_at, a.id), ''), 'UTF8')), 'hex')
  from public.attendance_sessions a
  where a.workspace_id = p_workspace and a.user_id = p_user and a.voided_at is null
    and tstzrange(a.started_at, coalesce(a.ended_at, 'infinity'::timestamptz), '[)') && app.week_range(p_workspace, p_week_start)
$$;

-- ═════════════ Weekly close (Decision 109) ═════════════
create or replace function app.close_week(p_workspace uuid, p_user uuid, p_week_start date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_range tstzrange := app.week_range(p_workspace, p_week_start);
  v_target integer;
  v_hours integer;
  v_id uuid;
  v_open uuid[];
begin
  if extract(dow from p_week_start) <> 6 then perform app.raise('HZ422', 'Weeks start on Saturday.'); end if;
  if upper(v_range) > now() then perform app.raise('HZ423', 'This week has not ended yet.'); end if;

  select id into v_id from public.week_closures where workspace_id = p_workspace and user_id = p_user and week_start = p_week_start;
  if v_id is not null then return v_id; end if;

  v_target := app.week_target_seconds(p_workspace, p_user, p_week_start);
  v_hours := app.closed_union_seconds(p_workspace, p_user, v_range);
  select coalesce(array_agg(a.id), '{}') into v_open
  from public.attendance_sessions a
  where a.workspace_id = p_workspace and a.user_id = p_user and a.voided_at is null and a.ended_at is null
    and a.started_at < upper(v_range);

  insert into public.week_closures (workspace_id, user_id, week_start, week_end, active_working_days, working_days_count,
                                   target_seconds, closed_union_seconds, regular_seconds, overtime_seconds,
                                   excluded_open_session_ids, source_fingerprint)
  values (p_workspace, p_user, p_week_start, p_week_start + 6,
          app.active_working_days(p_workspace, p_user, p_week_start),
          cardinality(coalesce((app.target_settings(p_workspace, p_week_start)).working_days, '{0,1,2,3,4}'::smallint[])),
          v_target, v_hours, least(v_target, v_hours), greatest(0, v_hours - v_target), v_open,
          app.week_fingerprint(p_workspace, p_user, p_week_start))
  on conflict (workspace_id, user_id, week_start) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.week_closures where workspace_id = p_workspace and user_id = p_user and week_start = p_week_start;
    return v_id;
  end if;

  perform app.emit(p_workspace, null, p_user, 'week_closure', v_id, null, 'payroll.week_closed',
    format('Week of %s closed for %s: %s regular, %s overtime', to_char(p_week_start, 'DD Mon YYYY'), app.display_name(p_user),
           to_char(make_interval(secs => least(v_target, v_hours)), 'HH24:MI'), to_char(make_interval(secs => greatest(0, v_hours - v_target)), 'HH24:MI')),
    null, null, jsonb_build_object('week_start', p_week_start), false, '/time?week=' || p_week_start::text, null, '{}');
  return v_id;
end $$;

-- Closes every employee week whose close time has passed (Saturday 23:59:59 by default). Idempotent catch-up.
create or replace function app.close_due_weeks(p_workspace uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  w record;
  m record;
  v_close_time time;
  v_week date;
  v_last date;
  v_count integer := 0;
begin
  for w in select * from public.workspaces where p_workspace is null or id = p_workspace loop
    v_close_time := coalesce((w.settings -> 'weekly_close' ->> 'time')::time, '23:59:59');
    for m in select * from public.workspace_members where workspace_id = w.id and role = 'employee' loop
      select coalesce(max(week_start) + 7, app.week_start_of(m.active_from)) into v_week
      from public.week_closures where workspace_id = w.id and user_id = m.user_id;
      -- Last week whose close moment (the Saturday after it ends, at the close time) has passed.
      v_last := app.week_start_of(app.local_date(w.id, now())) - 7;
      if app.local_ts(w.id, v_last + 7, v_close_time) > now() then v_last := v_last - 7; end if;
      if m.active_to is not null then v_last := least(v_last, app.week_start_of(m.active_to)); end if;
      while v_week <= v_last loop
        perform app.close_week(w.id, m.user_id, v_week);
        v_count := v_count + 1;
        v_week := v_week + 7;
      end loop;
    end loop;
  end loop;
  return v_count;
end $$;

-- After any change to attendance, post the signed difference for each touched closed week into the
-- current open week. Never rewrites a closed week (Decision 109).
create or replace function app.reconcile_closed_weeks(p_workspace uuid, p_user uuid, p_range tstzrange, p_cause uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c public.week_closures;
  v_hours integer;
  v_reg integer;
  v_ot integer;
  v_acc_hours integer;
  v_acc_reg integer;
  v_acc_ot integer;
  v_posted date := app.current_week_start(p_workspace);
  v_count integer := 0;
begin
  for c in
    select * from public.week_closures
    where workspace_id = p_workspace and user_id = p_user
      and app.week_range(p_workspace, week_start) && p_range
    order by week_start
  loop
    v_hours := app.closed_union_seconds(p_workspace, p_user, app.week_range(p_workspace, c.week_start));
    v_reg := least(c.target_seconds, v_hours);
    v_ot := greatest(0, v_hours - c.target_seconds);
    select c.closed_union_seconds + coalesce(sum(hours_delta_seconds), 0),
           c.regular_seconds + coalesce(sum(regular_delta_seconds), 0),
           c.overtime_seconds + coalesce(sum(overtime_delta_seconds), 0)
      into v_acc_hours, v_acc_reg, v_acc_ot
    from public.payroll_adjustments
    where workspace_id = p_workspace and user_id = p_user and source_week_start = c.week_start;

    if v_reg <> v_acc_reg or v_ot <> v_acc_ot then
      insert into public.payroll_adjustments (workspace_id, user_id, source_week_start, posted_week_start,
                                              hours_delta_seconds, regular_delta_seconds, overtime_delta_seconds, cause_audit_event_id)
      values (p_workspace, p_user, c.week_start, v_posted, v_hours - v_acc_hours, v_reg - v_acc_reg, v_ot - v_acc_ot, p_cause);
      perform app.emit(p_workspace, auth.uid(), p_user, 'week_closure', c.id, null, 'payroll.adjustment_posted',
        format('Closed week of %s was corrected: adjustment of %s regular, %s overtime posted to the week of %s',
               to_char(c.week_start, 'DD Mon'), app.fmt_signed_hours(v_reg - v_acc_reg), app.fmt_signed_hours(v_ot - v_acc_ot),
               to_char(v_posted, 'DD Mon')),
        null, jsonb_build_object('regular_delta', v_reg - v_acc_reg, 'overtime_delta', v_ot - v_acc_ot),
        jsonb_build_object('source_week', c.week_start, 'posted_week', v_posted), true, '/time?week=' || v_posted::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

create or replace function app.fmt_signed_hours(p_seconds integer) returns text
language sql immutable set search_path = '' as $$
  select case when p_seconds < 0 then '−' else '+' end
         || (abs(p_seconds) / 3600)::text || 'h' || lpad(((abs(p_seconds) % 3600) / 60)::text, 2, '0')
$$;

-- ═════════════ Activity validation (Decisions 82, 105) ═════════════
create or replace function app.validate_activity(p_workspace uuid, p_uid uuid, p_kind public.activity_kind, p_task uuid, p_general text)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tasks;
  v_parent public.task_status;
  v_warn text[] := '{}';
  v_types jsonb;
begin
  if p_kind = 'task' then
    select * into t from public.tasks where id = p_task;
    if not found or t.workspace_id <> p_workspace or t.assignee_id <> p_uid then perform app.raise('HZ404', 'Task not found.'); end if;
    if t.archived_at is not null then perform app.raise('HZ422', 'That task is archived.'); end if;
    if t.status = 'completed' then perform app.raise('HZ423', 'That task is completed. Reopen it before logging more work on it.'); end if;
    if t.status = 'cancelled' then perform app.raise('HZ423', 'That task is cancelled. Reactivate it first.'); end if;
    if t.parent_task_id is not null then
      select status into v_parent from public.tasks where id = t.parent_task_id;
      if v_parent = 'completed' then perform app.raise('HZ423', 'The parent task is completed. Reopen the parent before working on this subtask.'); end if;
    end if;
    if t.queue = 'planned' and t.parent_task_id is null then v_warn := array_append(v_warn, 'This task is in the Planned queue.'); end if;
    if t.status = 'on_hold' then v_warn := array_append(v_warn, 'This task is on hold. Its status stays unchanged.'); end if;
    if t.status = 'not_started' then v_warn := array_append(v_warn, 'This task is not started yet. Its status stays unchanged.'); end if;
  elsif p_kind = 'general' then
    if p_task is not null then perform app.raise('HZ422', 'General activity cannot reference a task.'); end if;
    select settings -> 'general_activity_types' into v_types from public.workspaces where id = p_workspace;
    if p_general is null or btrim(p_general) = '' then perform app.raise('HZ422', 'Choose a general activity type.'); end if;
    if v_types is not null and not (v_types ? p_general) then perform app.raise('HZ422', 'Unknown general activity type.'); end if;
  else
    if p_task is not null or p_general is not null then perform app.raise('HZ422', 'Unassigned time has no task or activity type.'); end if;
  end if;
  return v_warn;
end $$;

create or replace function app.activity_label(p_kind public.activity_kind, p_task uuid, p_general text) returns text
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'task' then coalesce((select '"' || title || '"' from public.tasks where id = p_task), 'a task')
    when 'general' then p_general
    else 'unassigned time' end
$$;

create or replace function app.require_employee(p_workspace uuid, p_uid uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.member_role(p_workspace, p_uid) is distinct from 'employee' then
    perform app.raise('HZ403', 'Only the employee records attendance and time.');
  end if;
end $$;

-- Re-tiles a session with segments after its bounds change: clips overhanging segments, voids
-- segments outside it, and fills any gap with unassigned time (never invents an activity, Decision 99).
create or replace function app.normalize_session_segments(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.attendance_sessions;
  v_range tstzrange;
  g tstzrange;
begin
  select * into s from public.attendance_sessions where id = p_session;
  if s.voided_at is not null then
    update public.live_activity_segments set voided_at = now() where attendance_session_id = s.id and voided_at is null;
    return;
  end if;
  v_range := tstzrange(s.started_at, s.ended_at, '[)');

  update public.live_activity_segments set voided_at = now()
  where attendance_session_id = s.id and voided_at is null
    and not (tstzrange(started_at, ended_at, '[)') && v_range);

  update public.live_activity_segments set
    started_at = greatest(started_at, s.started_at),
    ended_at = case
      when s.ended_at is null then ended_at
      when ended_at is null or ended_at > s.ended_at then s.ended_at
      else ended_at end
  where attendance_session_id = s.id and voided_at is null
    and (started_at < s.started_at or (s.ended_at is not null and (ended_at is null or ended_at > s.ended_at)));

  for g in
    select x from unnest(
      tstzmultirange(v_range) - coalesce(
        (select range_agg(tstzrange(started_at, ended_at, '[)')) from public.live_activity_segments
         where attendance_session_id = s.id and voided_at is null),
        '{}'::tstzmultirange)
    ) x
  loop
    insert into public.live_activity_segments (workspace_id, user_id, attendance_session_id, kind, started_at, ended_at)
    values (s.workspace_id, s.user_id, s.id, 'unassigned', lower(g), upper(g));
  end loop;
end $$;

-- ═════════════ Clock in / switch / clock out (Decisions 73–81) ═════════════
create or replace function public.clock_in(
  p_workspace uuid,
  p_kind public.activity_kind default 'unassigned',
  p_task uuid default null,
  p_general_type text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_session uuid;
  v_segment uuid;
  v_warn text[];
begin
  perform app.require_employee(p_workspace, v_uid);
  v_warn := app.validate_activity(p_workspace, v_uid, p_kind, p_task, p_general_type);
  begin
    insert into public.attendance_sessions (workspace_id, user_id, started_at, origin)
    values (p_workspace, v_uid, now(), 'clock') returning id into v_session;
    insert into public.live_activity_segments (workspace_id, user_id, attendance_session_id, kind, task_id, general_type, started_at)
    values (p_workspace, v_uid, v_session, p_kind, p_task, nullif(btrim(coalesce(p_general_type, '')), ''), now()) returning id into v_segment;
  exception when unique_violation or exclusion_violation then
    perform app.raise('HZ409', 'You are already clocked in (possibly from another device). Refresh to see your current session.');
  end;
  perform app.emit(p_workspace, v_uid, v_uid, 'attendance', v_session, p_task, 'attendance.clock_in',
    format('%s clocked in — %s', app.display_name(v_uid), app.activity_label(p_kind, p_task, p_general_type)),
    null, null, '{}'::jsonb, false, null, null, '{}');
  return jsonb_build_object('session_id', v_session, 'segment_id', v_segment, 'warnings', to_jsonb(v_warn), 'at', now());
end $$;

create or replace function public.switch_activity(
  p_workspace uuid,
  p_expected_segment uuid,
  p_kind public.activity_kind,
  p_task uuid default null,
  p_general_type text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  cur public.live_activity_segments;
  v_new uuid;
  v_warn text[];
  v_general text := nullif(btrim(coalesce(p_general_type, '')), '');
begin
  perform app.require_employee(p_workspace, v_uid);
  select * into cur from public.live_activity_segments
  where workspace_id = p_workspace and user_id = v_uid and ended_at is null and voided_at is null
  for update;
  if not found then
    -- A concurrent switch may have replaced the segment we waited on; tell the loser to refresh.
    if exists (select 1 from public.attendance_sessions where workspace_id = p_workspace and user_id = v_uid and ended_at is null and voided_at is null) then
      perform app.raise('HZ409', 'Your activity changed on another device. Refresh and try again.');
    end if;
    perform app.raise('HZ422', 'Clock in first.');
  end if;
  if p_expected_segment is not null and cur.id <> p_expected_segment then
    perform app.raise('HZ409', 'Your activity changed on another device. Refresh and try again.');
  end if;
  v_warn := app.validate_activity(p_workspace, v_uid, p_kind, p_task, v_general);
  if cur.kind = p_kind and cur.task_id is not distinct from p_task and cur.general_type is not distinct from v_general then
    return jsonb_build_object('segment_id', cur.id, 'warnings', to_jsonb(v_warn), 'unchanged', true);
  end if;

  if cur.started_at >= now() then
    update public.live_activity_segments set voided_at = now() where id = cur.id;
  else
    update public.live_activity_segments set ended_at = now() where id = cur.id;
  end if;
  insert into public.live_activity_segments (workspace_id, user_id, attendance_session_id, kind, task_id, general_type, started_at)
  values (p_workspace, v_uid, cur.attendance_session_id, p_kind, p_task, v_general, now())
  returning id into v_new;

  perform app.emit(p_workspace, v_uid, v_uid, 'activity', v_new, p_task, 'activity.switched',
    format('%s switched to %s', app.display_name(v_uid), app.activity_label(p_kind, p_task, v_general)),
    jsonb_build_object('kind', cur.kind, 'task_id', cur.task_id, 'general_type', cur.general_type),
    jsonb_build_object('kind', p_kind, 'task_id', p_task, 'general_type', v_general), '{}'::jsonb, false, null, null, '{}');
  return jsonb_build_object('segment_id', v_new, 'warnings', to_jsonb(v_warn), 'at', now());
end $$;

-- Clock out closes the live segment and the session at the same server instant (Decision 80).
-- Standalone task timers keep running (Decision 40).
create or replace function public.clock_out(p_workspace uuid, p_expected_session uuid default null, p_summary text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  s public.attendance_sessions;
  v_event uuid;
  v_now timestamptz := now();
begin
  perform app.require_employee(p_workspace, v_uid);
  select * into s from public.attendance_sessions
  where workspace_id = p_workspace and user_id = v_uid and ended_at is null and voided_at is null
  for update;
  if not found then
    perform app.raise(case when p_expected_session is not null then 'HZ409' else 'HZ422' end,
      case when p_expected_session is not null then 'You were already clocked out (possibly from another device).' else 'You are not clocked in.' end);
  end if;
  if p_expected_session is not null and s.id <> p_expected_session then
    perform app.raise('HZ409', 'Your session changed on another device. Refresh and try again.');
  end if;
  if s.started_at >= v_now then perform app.raise('HZ422', 'This session only just started. Try again in a moment.'); end if;

  update public.live_activity_segments set ended_at = v_now
  where attendance_session_id = s.id and ended_at is null and voided_at is null;
  update public.attendance_sessions set ended_at = v_now, summary = nullif(btrim(coalesce(p_summary, '')), ''), version = version + 1
  where id = s.id;

  v_event := app.emit(p_workspace, v_uid, v_uid, 'attendance', s.id, null, 'attendance.clock_out',
    format('%s clocked out after %s', app.display_name(v_uid), to_char(v_now - s.started_at, 'HH24"h"MI')),
    null, jsonb_build_object('ended_at', v_now), jsonb_build_object('summary', p_summary), false, null, null, '{}');
  -- A forgotten session that ran across a closed week posts its closed-week share as an adjustment.
  perform app.reconcile_closed_weeks(p_workspace, v_uid, tstzrange(s.started_at, v_now, '[)'), v_event);
  return jsonb_build_object('session_id', s.id, 'ended_at', v_now, 'duration_seconds', extract(epoch from v_now - s.started_at)::integer);
end $$;

-- ═════════════ Attendance corrections (Decisions 27, 28, 43, 69, 109) ═════════════
create or replace function app.assert_session_bounds(p_workspace uuid, p_uid uuid, p_started timestamptz, p_ended timestamptz) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_from date;
begin
  if p_started is null then perform app.raise('HZ422', 'Start time is required.'); end if;
  if p_ended is not null and p_ended <= p_started then perform app.raise('HZ422', 'End must be after start.'); end if;
  if p_started > now() or (p_ended is not null and p_ended > now()) then perform app.raise('HZ422', 'Times cannot be in the future.'); end if;
  if p_ended is not null and p_ended - p_started > interval '24 hours' then
    perform app.raise('HZ422', 'A single session cannot be longer than 24 hours. Split it into separate sessions.');
  end if;
  select active_from into v_from from public.workspace_members where workspace_id = p_workspace and user_id = p_uid;
  if app.local_date(p_workspace, p_started) < v_from then
    perform app.raise('HZ422', 'That time is before your membership started.');
  end if;
end $$;

create or replace function public.add_attendance_session(
  p_workspace uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason text,
  p_kind public.activity_kind default 'unassigned',
  p_task uuid default null,
  p_general_type text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
  v_event uuid;
begin
  perform app.require_employee(p_workspace, v_uid);
  if char_length(v_reason) < 3 then perform app.raise('HZ422', 'A reason is required for a backdated session.'); end if;
  if p_ended_at is null then perform app.raise('HZ422', 'A backdated session needs an end time. Use Clock in for live work.'); end if;
  perform app.assert_session_bounds(p_workspace, v_uid, p_started_at, p_ended_at);
  perform app.validate_activity(p_workspace, v_uid, p_kind, p_task, p_general_type);
  begin
    insert into public.attendance_sessions (workspace_id, user_id, started_at, ended_at, origin)
    values (p_workspace, v_uid, p_started_at, p_ended_at, 'manual') returning id into v_id;
    insert into public.live_activity_segments (workspace_id, user_id, attendance_session_id, kind, task_id, general_type, started_at, ended_at)
    values (p_workspace, v_uid, v_id, p_kind, p_task, nullif(btrim(coalesce(p_general_type, '')), ''), p_started_at, p_ended_at);
  exception when exclusion_violation then
    perform app.raise('HZ422', 'That time overlaps another attendance session.');
  end;
  v_event := app.emit(p_workspace, v_uid, v_uid, 'attendance', v_id, null, 'attendance.session_added',
    format('%s added a backdated session: %s', app.display_name(v_uid), to_char(p_ended_at - p_started_at, 'HH24"h"MI')),
    null, jsonb_build_object('started_at', p_started_at, 'ended_at', p_ended_at),
    jsonb_build_object('reason', v_reason, 'body', v_reason), false, '/time');
  perform app.reconcile_closed_weeks(p_workspace, v_uid, tstzrange(p_started_at, p_ended_at, '[)'), v_event);
  return v_id;
end $$;

create or replace function public.correct_attendance(
  p_session uuid,
  p_expected_version integer,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  s public.attendance_sessions;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_event uuid;
begin
  select * into s from public.attendance_sessions where id = p_session for update;
  if not found or not app.can_view_user_work(s.workspace_id, s.user_id) then perform app.raise('HZ404', 'Session not found.'); end if;
  if s.user_id <> v_uid then perform app.raise('HZ403', 'Only the employee corrects their own attendance.'); end if;
  if s.voided_at is not null then perform app.raise('HZ422', 'This session was removed.'); end if;
  perform app.check_version(s.version, p_expected_version);
  if char_length(v_reason) < 3 then perform app.raise('HZ422', 'A reason is required for a correction.'); end if;
  if s.ended_at is not null and p_ended_at is null then
    perform app.raise('HZ422', 'A closed session cannot be reopened. Clock in again instead.');
  end if;
  perform app.assert_session_bounds(s.workspace_id, v_uid, p_started_at, p_ended_at);

  begin
    update public.attendance_sessions set started_at = p_started_at, ended_at = p_ended_at, version = version + 1 where id = s.id;
    perform app.normalize_session_segments(s.id);
  exception when exclusion_violation then
    perform app.raise('HZ422', 'The corrected times overlap another attendance session.');
  end;

  v_event := app.emit(s.workspace_id, v_uid, v_uid, 'attendance', s.id, null, 'attendance.corrected',
    format('%s corrected an attendance session', app.display_name(v_uid)),
    jsonb_build_object('started_at', s.started_at, 'ended_at', s.ended_at),
    jsonb_build_object('started_at', p_started_at, 'ended_at', p_ended_at),
    jsonb_build_object('reason', v_reason, 'body', v_reason), false, '/time');
  perform app.reconcile_closed_weeks(s.workspace_id, v_uid,
    tstzrange(least(s.started_at, p_started_at), greatest(coalesce(s.ended_at, now()), coalesce(p_ended_at, now())), '[]'), v_event);
  return s.version + 1;
end $$;

create or replace function public.void_attendance_session(p_session uuid, p_expected_version integer, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  s public.attendance_sessions;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_event uuid;
begin
  select * into s from public.attendance_sessions where id = p_session for update;
  if not found or not app.can_view_user_work(s.workspace_id, s.user_id) then perform app.raise('HZ404', 'Session not found.'); end if;
  if s.user_id <> v_uid then perform app.raise('HZ403', 'Only the employee corrects their own attendance.'); end if;
  if s.voided_at is not null then return; end if;
  perform app.check_version(s.version, p_expected_version);
  if char_length(v_reason) < 3 then perform app.raise('HZ422', 'A reason is required to remove a session.'); end if;

  update public.attendance_sessions set voided_at = now(), void_reason = v_reason, version = version + 1 where id = s.id;
  perform app.normalize_session_segments(s.id);
  v_event := app.emit(s.workspace_id, v_uid, v_uid, 'attendance', s.id, null, 'attendance.removed',
    format('%s removed an attendance session', app.display_name(v_uid)),
    jsonb_build_object('started_at', s.started_at, 'ended_at', s.ended_at), null,
    jsonb_build_object('reason', v_reason, 'body', v_reason), false, '/time');
  perform app.reconcile_closed_weeks(s.workspace_id, v_uid, tstzrange(s.started_at, coalesce(s.ended_at, now()), '[]'), v_event);
end $$;

-- Re-label part or all of a segment with the real activity, at the real transition time (Decisions 79, 102).
-- The original segment is kept (voided) with its pieces pointing back to it.
create or replace function public.reclassify_segment(
  p_segment uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_kind public.activity_kind,
  p_task uuid default null,
  p_general_type text default null,
  p_reason text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  seg public.live_activity_segments;
  v_from timestamptz;
  v_to timestamptz;
  v_new uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_general text := nullif(btrim(coalesce(p_general_type, '')), '');
begin
  select * into seg from public.live_activity_segments where id = p_segment for update;
  if not found or not app.can_view_user_work(seg.workspace_id, seg.user_id) then perform app.raise('HZ404', 'Activity not found.'); end if;
  if seg.user_id <> v_uid then perform app.raise('HZ403', 'Only the employee corrects their own activity.'); end if;
  if seg.voided_at is not null then perform app.raise('HZ409', 'This activity was already changed. Refresh and try again.'); end if;
  if char_length(v_reason) < 3 then perform app.raise('HZ422', 'A reason is required for a correction.'); end if;
  perform app.validate_activity(seg.workspace_id, v_uid, p_kind, p_task, v_general);

  v_from := coalesce(p_from, seg.started_at);
  v_to := case when p_to is null then seg.ended_at else p_to end;
  if v_from < seg.started_at or v_from >= coalesce(v_to, 'infinity'::timestamptz)
     or (v_to is not null and seg.ended_at is not null and v_to > seg.ended_at)
     or (v_to is not null and seg.ended_at is null and v_to > now())
     or v_from > now() then
    perform app.raise('HZ422', 'The new range must sit inside the original activity.');
  end if;

  update public.live_activity_segments set voided_at = now() where id = seg.id;
  if v_from > seg.started_at then
    insert into public.live_activity_segments (workspace_id, user_id, attendance_session_id, kind, task_id, general_type, started_at, ended_at, split_from)
    values (seg.workspace_id, seg.user_id, seg.attendance_session_id, seg.kind, seg.task_id, seg.general_type, seg.started_at, v_from, seg.id);
  end if;
  insert into public.live_activity_segments (workspace_id, user_id, attendance_session_id, kind, task_id, general_type, started_at, ended_at, split_from)
  values (seg.workspace_id, seg.user_id, seg.attendance_session_id, p_kind, p_task, v_general, v_from, v_to, seg.id)
  returning id into v_new;
  if v_to is not null and (seg.ended_at is null or v_to < seg.ended_at) then
    insert into public.live_activity_segments (workspace_id, user_id, attendance_session_id, kind, task_id, general_type, started_at, ended_at, split_from)
    values (seg.workspace_id, seg.user_id, seg.attendance_session_id, seg.kind, seg.task_id, seg.general_type, v_to, seg.ended_at, seg.id);
  end if;

  perform app.emit(seg.workspace_id, v_uid, v_uid, 'activity', v_new, p_task, 'activity.reclassified',
    format('%s re-labelled %s of %s as %s', app.display_name(v_uid),
           to_char(coalesce(v_to, now()) - v_from, 'HH24"h"MI'), app.activity_label(seg.kind, seg.task_id, seg.general_type),
           app.activity_label(p_kind, p_task, v_general)),
    jsonb_build_object('segment', seg.id, 'kind', seg.kind, 'task_id', seg.task_id, 'general_type', seg.general_type),
    jsonb_build_object('from', v_from, 'to', v_to, 'kind', p_kind, 'task_id', p_task, 'general_type', v_general),
    jsonb_build_object('reason', v_reason, 'body', v_reason), false, '/time');
  return v_new;
end $$;

-- ═════════════ Standalone task time (Decisions 29–31, 40, 41) ═════════════
create or replace function public.start_task_timer(p_task uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_id uuid;
begin
  perform app.require_employee(t.workspace_id, v_uid);
  perform app.validate_activity(t.workspace_id, v_uid, 'task', p_task, null);
  begin
    insert into public.task_time_entries (workspace_id, user_id, task_id, source, started_at)
    values (t.workspace_id, v_uid, p_task, 'timer', now()) returning id into v_id;
  exception when unique_violation then
    perform app.raise('HZ409', 'A task timer is already running. Stop it first.');
  end;
  perform app.emit(t.workspace_id, v_uid, v_uid, 'task_time', v_id, p_task, 'time.timer_started',
    format('%s started a timer on "%s"', app.display_name(v_uid), t.title), null, null, '{}'::jsonb, false, null, null, '{}');
  return v_id;
end $$;

create or replace function public.stop_task_timer(p_entry uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  e public.task_time_entries;
begin
  select * into e from public.task_time_entries
  where user_id = v_uid and source = 'timer' and ended_at is null and voided_at is null and (p_entry is null or id = p_entry)
  for update;
  if not found then perform app.raise('HZ422', 'No timer is running.'); end if;
  if e.started_at >= now() then
    update public.task_time_entries set voided_at = now(), void_reason = 'Stopped immediately' where id = e.id;
  else
    update public.task_time_entries set ended_at = now(), version = version + 1 where id = e.id;
  end if;
  perform app.emit(e.workspace_id, v_uid, v_uid, 'task_time', e.id, e.task_id, 'time.timer_stopped',
    format('%s stopped a timer after %s', app.display_name(v_uid), to_char(now() - e.started_at, 'HH24"h"MI')),
    null, null, '{}'::jsonb, false, null, null, '{}');
  return jsonb_build_object('entry_id', e.id, 'seconds', extract(epoch from now() - e.started_at)::integer);
end $$;

-- All task-time intervals of one person (live task segments + entries), for overlap checks.
create or replace function app.user_task_time_ranges(p_workspace uuid, p_user uuid, p_exclude uuid default null)
returns tstzmultirange
language sql stable security definer set search_path = '' as $$
  select coalesce(range_agg(r), '{}'::tstzmultirange) from (
    select tstzrange(started_at, coalesce(ended_at, now()), '[)') r from public.live_activity_segments
    where workspace_id = p_workspace and user_id = p_user and kind = 'task' and voided_at is null and started_at < coalesce(ended_at, now())
    union all
    select tstzrange(started_at, coalesce(ended_at, now()), '[)') from public.task_time_entries
    where workspace_id = p_workspace and user_id = p_user and voided_at is null and (p_exclude is null or id <> p_exclude)
      and started_at < coalesce(ended_at, now())
  ) x
$$;

create or replace function public.add_manual_time(
  p_task uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_note text default null,
  p_acknowledge_overlap boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_overlap boolean;
  v_id uuid;
begin
  perform app.require_employee(t.workspace_id, v_uid);
  perform app.validate_activity(t.workspace_id, v_uid, 'task', p_task, null);
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then perform app.raise('HZ422', 'End must be after start.'); end if;
  if p_ended_at > now() then perform app.raise('HZ422', 'Times cannot be in the future.'); end if;
  if p_ended_at - p_started_at > interval '24 hours' then perform app.raise('HZ422', 'Entries cannot be longer than 24 hours.'); end if;

  v_overlap := app.user_task_time_ranges(t.workspace_id, v_uid) && tstzrange(p_started_at, p_ended_at, '[)');
  if v_overlap and not coalesce(p_acknowledge_overlap, false) then
    raise exception 'This overlaps task time you already recorded. Confirm to keep both; reports show raw and de-duplicated totals.'
      using errcode = 'HZ422', detail = 'overlap';
  end if;

  insert into public.task_time_entries (workspace_id, user_id, task_id, source, started_at, ended_at, note, overlap_acknowledged)
  values (t.workspace_id, v_uid, p_task, 'manual', p_started_at, p_ended_at, nullif(btrim(coalesce(p_note, '')), ''), v_overlap)
  returning id into v_id;
  perform app.emit(t.workspace_id, v_uid, v_uid, 'task_time', v_id, p_task, 'time.manual_added',
    format('%s added %s of time to "%s"%s', app.display_name(v_uid), to_char(p_ended_at - p_started_at, 'HH24"h"MI'), t.title,
           case when v_overlap then ' (overlapping)' else '' end),
    null, jsonb_build_object('started_at', p_started_at, 'ended_at', p_ended_at), jsonb_build_object('note', p_note), false,
    app.task_link(coalesce(t.parent_task_id, t.id)), null, '{}');
  return v_id;
end $$;

create or replace function public.void_time_entry(p_entry uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  e public.task_time_entries;
begin
  select * into e from public.task_time_entries where id = p_entry for update;
  if not found or not app.can_view_user_work(e.workspace_id, e.user_id) then perform app.raise('HZ404', 'Entry not found.'); end if;
  if e.user_id <> v_uid then perform app.raise('HZ403', 'Only the employee edits their own time.'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then perform app.raise('HZ422', 'A reason is required.'); end if;
  if e.voided_at is not null then return; end if;
  update public.task_time_entries set voided_at = now(), void_reason = btrim(p_reason), ended_at = coalesce(ended_at, greatest(now(), started_at + interval '1 second')),
    version = version + 1 where id = e.id;
  perform app.emit(e.workspace_id, v_uid, v_uid, 'task_time', e.id, e.task_id, 'time.entry_removed',
    format('%s removed a task time entry', app.display_name(v_uid)), null, null,
    jsonb_build_object('reason', p_reason, 'body', p_reason), false, null, null, '{}');
end $$;

-- ═════════════ Settings (manager, Decisions 71, 109, 110) ═════════════
create or replace function public.set_weekly_target(p_workspace uuid, p_effective_from date, p_minutes integer, p_working_days smallint[])
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid();
begin
  perform app.require_manager(p_workspace, v_uid);
  if extract(dow from p_effective_from) <> 6 then perform app.raise('HZ422', 'Changes take effect from a Saturday (start of a week).'); end if;
  if p_effective_from < app.current_week_start(p_workspace) then perform app.raise('HZ422', 'Changes cannot apply to past weeks.'); end if;
  if p_minutes is null or p_minutes <= 0 then perform app.raise('HZ422', 'The weekly target must be positive.'); end if;
  if p_working_days is null or cardinality(p_working_days) = 0 then perform app.raise('HZ422', 'Choose at least one working day.'); end if;
  insert into public.weekly_target_settings (workspace_id, effective_from, base_target_minutes, working_days, created_by)
  values (p_workspace, p_effective_from, p_minutes, (select array_agg(distinct d order by d) from unnest(p_working_days) d), v_uid)
  on conflict (workspace_id, effective_from) do update set base_target_minutes = excluded.base_target_minutes,
    working_days = excluded.working_days, created_by = excluded.created_by, created_at = now();
  perform app.emit(p_workspace, v_uid, null, 'workspace', p_workspace, null, 'settings.weekly_target',
    format('%s set the weekly target to %s h from %s', app.display_name(v_uid), round(p_minutes / 60.0, 2), to_char(p_effective_from, 'DD Mon YYYY')),
    null, jsonb_build_object('minutes', p_minutes, 'working_days', p_working_days, 'effective_from', p_effective_from),
    '{}'::jsonb, true, '/settings');
end $$;

create or replace function public.set_workspace_time_settings(p_workspace uuid, p_close_time time default null, p_general_types text[] default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  w public.workspaces;
  v_settings jsonb;
begin
  perform app.require_manager(p_workspace, v_uid);
  select * into w from public.workspaces where id = p_workspace for update;
  v_settings := w.settings;
  if p_close_time is not null then
    v_settings := jsonb_set(v_settings, '{weekly_close}', jsonb_build_object('dow', 6, 'time', to_char(p_close_time, 'HH24:MI:SS')));
  end if;
  if p_general_types is not null then
    if cardinality(p_general_types) = 0 then perform app.raise('HZ422', 'Keep at least one general activity type.'); end if;
    v_settings := jsonb_set(v_settings, '{general_activity_types}',
      (select jsonb_agg(distinct btrim(x)) from unnest(p_general_types) x where btrim(x) <> ''));
  end if;
  update public.workspaces set settings = v_settings where id = p_workspace;
  perform app.emit(p_workspace, v_uid, null, 'workspace', p_workspace, null, 'settings.time',
    format('%s updated time settings', app.display_name(v_uid)), w.settings, v_settings, '{}'::jsonb, false, '/settings');
end $$;

-- ═════════════ Read models ═════════════
create or replace function public.close_my_due_weeks(p_workspace uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid();
begin
  if not app.is_member(p_workspace) then perform app.raise('HZ403', 'You are not a member of this workspace.'); end if;
  return app.close_due_weeks(p_workspace);
end $$;

create or replace function public.get_week_summary(p_workspace uuid, p_user uuid, p_week_start date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_week date := app.week_start_of(p_week_start);
  v_range tstzrange;
  c public.week_closures;
  v_target integer;
  v_closed integer;
  v_open integer;
  v_reg integer;
  v_ot integer;
  v_in jsonb;
  v_out jsonb;
  v_in_reg integer;
  v_in_ot integer;
  v_close_time time;
  s public.weekly_target_settings;
begin
  if not app.can_view_user_work(p_workspace, p_user) then perform app.raise('HZ404', 'Not found.'); end if;
  v_range := app.week_range(p_workspace, v_week);
  select * into c from public.week_closures where workspace_id = p_workspace and user_id = p_user and week_start = v_week;
  s := app.target_settings(p_workspace, v_week);
  select coalesce((settings -> 'weekly_close' ->> 'time')::time, '23:59:59') into v_close_time from public.workspaces where id = p_workspace;

  v_target := coalesce(c.target_seconds, app.week_target_seconds(p_workspace, p_user, v_week));
  v_closed := app.closed_union_seconds(p_workspace, p_user, v_range);
  v_open := app.open_session_seconds(p_workspace, p_user, v_range);
  v_reg := coalesce(c.regular_seconds, least(v_target, v_closed));
  v_ot := coalesce(c.overtime_seconds, greatest(0, v_closed - v_target));

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb), coalesce(sum(a.regular_delta_seconds), 0), coalesce(sum(a.overtime_delta_seconds), 0)
    into v_in, v_in_reg, v_in_ot
  from public.payroll_adjustments a where a.workspace_id = p_workspace and a.user_id = p_user and a.posted_week_start = v_week;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb) into v_out
  from public.payroll_adjustments a where a.workspace_id = p_workspace and a.user_id = p_user and a.source_week_start = v_week;

  return jsonb_build_object(
    'week_start', v_week,
    'week_end', v_week + 6,
    'payroll_month', to_char(v_week + 6, 'YYYY-MM'),
    'starts_at', lower(v_range),
    'ends_at', upper(v_range),
    'closes_at', app.local_ts(p_workspace, v_week + 7, v_close_time),
    'status', case when c.id is not null then 'closed' when upper(v_range) <= now() then 'awaiting_close' else 'open' end,
    'closure', case when c.id is null then null else to_jsonb(c) end,
    'base_target_minutes', coalesce(s.base_target_minutes, 1200),
    'working_days', to_jsonb(coalesce(s.working_days, '{0,1,2,3,4}'::smallint[])),
    'active_working_days', coalesce(c.active_working_days, app.active_working_days(p_workspace, p_user, v_week)),
    'target_seconds', v_target,
    'closed_seconds', coalesce(c.closed_union_seconds, v_closed),
    'current_closed_seconds', v_closed,
    'provisional_open_seconds', v_open,
    'regular_seconds', v_reg,
    'overtime_seconds', v_ot,
    'adjustments_in', v_in,
    'adjustments_out', v_out,
    'net_regular_seconds', v_reg + v_in_reg,
    'net_overtime_seconds', v_ot + v_in_ot,
    'fingerprint_changed', case when c.id is null then null else c.source_fingerprint <> app.week_fingerprint(p_workspace, p_user, v_week) end
  );
end $$;

-- Weekly overtime belongs to the month containing that week's Friday (Decision 53).
create or replace function public.get_month_overtime(p_workspace uuid, p_user uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_first date := date_trunc('month', p_month)::date;
  v_weeks jsonb := '[]'::jsonb;
  v_week date;
  v_sum jsonb;
  v_total integer := 0;
  v_final boolean := true;
begin
  if not app.can_view_user_work(p_workspace, p_user) then perform app.raise('HZ404', 'Not found.'); end if;
  -- First Friday on/after the 1st, back to its Saturday.
  v_week := app.week_start_of(v_first + ((5 - extract(dow from v_first)::integer + 7) % 7));
  while (v_week + 6) < (v_first + interval '1 month')::date loop
    v_sum := public.get_week_summary(p_workspace, p_user, v_week);
    v_weeks := v_weeks || jsonb_build_object('week_start', v_week, 'status', v_sum ->> 'status',
      'net_overtime_seconds', (v_sum ->> 'net_overtime_seconds')::integer, 'net_regular_seconds', (v_sum ->> 'net_regular_seconds')::integer);
    v_total := v_total + (v_sum ->> 'net_overtime_seconds')::integer;
    if v_sum ->> 'status' <> 'closed' then v_final := false; end if;
    v_week := v_week + 7;
  end loop;
  return jsonb_build_object('month', to_char(v_first, 'YYYY-MM'), 'weeks', v_weeks, 'net_overtime_seconds', v_total, 'final', v_final);
end $$;

-- Task time: raw vs de-duplicated, direct vs parent rollup (Decisions 41, 46, test A21).
create or replace function public.get_task_time(p_task uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks;
  v_ids uuid[];
begin
  select * into t from public.tasks where id = p_task;
  if not found or not app.can_view_user_work(t.workspace_id, t.assignee_id) then perform app.raise('HZ404', 'Task not found.'); end if;
  select array_agg(id) into v_ids from public.tasks where id = p_task or parent_task_id = p_task;

  return (
    with src as (
      select task_id, 'live'::text as source, started_at, coalesce(ended_at, now()) as ended_at, ended_at is null as running, id
      from public.live_activity_segments where task_id = any (v_ids) and voided_at is null
      union all
      select task_id, source::text, started_at, coalesce(ended_at, now()), ended_at is null, id
      from public.task_time_entries where task_id = any (v_ids) and voided_at is null
    ), valid as (
      select * from src where ended_at > started_at
    )
    select jsonb_build_object(
      'direct_raw_seconds', coalesce((select sum(extract(epoch from ended_at - started_at)) from valid where task_id = p_task), 0)::integer,
      'direct_unique_seconds', coalesce((select sum(extract(epoch from upper(r) - lower(r))) from unnest(
          (select range_agg(tstzrange(started_at, ended_at, '[)')) from valid where task_id = p_task)) r), 0)::integer,
      'rollup_raw_seconds', coalesce((select sum(extract(epoch from ended_at - started_at)) from valid), 0)::integer,
      'rollup_unique_seconds', coalesce((select sum(extract(epoch from upper(r) - lower(r))) from unnest(
          (select range_agg(tstzrange(started_at, ended_at, '[)')) from valid)) r), 0)::integer,
      'running', exists (select 1 from valid where running and task_id = p_task),
      'estimated_minutes', t.estimated_minutes,
      'entries', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'task_id', task_id, 'source', source, 'started_at', started_at,
                 'ended_at', case when running then null else ended_at end, 'seconds', extract(epoch from ended_at - started_at)::integer)
                 order by started_at desc) from valid), '[]'::jsonb)
    )
  );
end $$;

-- ═════════════ Grants and schedules ═════════════
revoke all on all functions in schema public from public, anon;
grant execute on function
  public.clock_in(uuid, public.activity_kind, uuid, text),
  public.switch_activity(uuid, uuid, public.activity_kind, uuid, text),
  public.clock_out(uuid, uuid, text),
  public.add_attendance_session(uuid, timestamptz, timestamptz, text, public.activity_kind, uuid, text),
  public.correct_attendance(uuid, integer, timestamptz, timestamptz, text),
  public.void_attendance_session(uuid, integer, text),
  public.reclassify_segment(uuid, timestamptz, timestamptz, public.activity_kind, uuid, text, text),
  public.start_task_timer(uuid),
  public.stop_task_timer(uuid),
  public.add_manual_time(uuid, timestamptz, timestamptz, text, boolean),
  public.void_time_entry(uuid, text),
  public.set_weekly_target(uuid, date, integer, smallint[]),
  public.set_workspace_time_settings(uuid, time, text[]),
  public.close_my_due_weeks(uuid),
  public.get_week_summary(uuid, uuid, date),
  public.get_month_overtime(uuid, uuid, date),
  public.get_task_time(uuid)
to authenticated;
grant execute on function app.week_start_of(date) to authenticated;

-- Weekly close catch-up every 15 minutes when pg_cron is available (idempotent).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hobzerve-close-weeks', '*/15 * * * *', 'select app.close_due_weeks()');
  end if;
end $$;
