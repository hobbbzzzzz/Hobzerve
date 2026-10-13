-- Hobzerve Stage 3 (part 2) — calendar read models and analytics (CALENDAR_SPEC.md, ANALYTICS_SPEC.md).
-- Local days come from the workspace timezone (Africa/Cairo); every boundary is computed with AT TIME ZONE, so DST
-- days are 23 or 25 hours long instead of being forced to 24.

-- ═════════════ Shared helpers ═════════════
-- Tightened: a manager sees work only of people who are members of the same workspace (previously any subject id
-- passed the check, and only the workspace filter on the data kept other workspaces out).
create or replace function app.can_view_user_work(p_workspace uuid, p_subject uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case app.member_role(p_workspace)
    when 'manager' then exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace and m.user_id = p_subject)
    when 'employee' then p_subject = auth.uid()
    else false
  end
$$;

-- [local p_from 00:00, local (p_to + 1) 00:00)
create or replace function app.day_range(p_ws uuid, p_from date, p_to date default null) returns tstzrange
language sql stable security definer set search_path = '' as $$
  select tstzrange(app.local_ts(p_ws, p_from), app.local_ts(p_ws, coalesce(p_to, p_from) + 1), '[)')
$$;

create or replace function app.mr_seconds(p tstzmultirange) returns integer
language sql immutable set search_path = '' as $$
  select coalesce(sum(extract(epoch from upper(r) - lower(r))), 0)::integer from unnest(coalesce(p, '{}'::tstzmultirange)) r
$$;

-- Interval of a possibly-open record clipped to a range. Open records run to now() when p_live, else they are ignored.
create or replace function app.clip(p_start timestamptz, p_end timestamptz, p_range tstzrange, p_live boolean default true)
returns tstzrange
language sql stable set search_path = '' as $$
  select case
    when p_end is null and not p_live then 'empty'::tstzrange
    when coalesce(p_end, now()) <= p_start then 'empty'::tstzrange
    else tstzrange(p_start, coalesce(p_end, now()), '[)') * p_range
  end
$$;

create or replace function app.task_matches(t public.tasks, f jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select (f ->> 'category_id' is null or t.category_id::text = f ->> 'category_id')
     and (f ->> 'work_type' is null or t.work_type::text = f ->> 'work_type')
     and (f ->> 'priority' is null or t.priority_level::text = f ->> 'priority')
     and (f ->> 'origin' is null or t.origin::text = f ->> 'origin')
     and (f ->> 'status' is null or t.status::text = f ->> 'status')
$$;

-- "Worked on" (Decision 49): the employee's own progress, deliverable or completion activity, or positive task time
-- (live task activity or timers/manual entries). Administrative edits never qualify. Returns tasks at any level.
create or replace function app.worked_task_ids(p_ws uuid, p_user uuid, p_range tstzrange, p_live boolean default true)
returns table (task_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct x.task_id from (
    select a.task_id from public.audit_events a
    where a.workspace_id = p_ws and a.actor_id = p_user and a.task_id is not null and a.occurred_at <@ p_range
      and a.event_type in ('task.progress_updated', 'deliverable.status_changed', 'deliverable.extra_added',
                           'deliverable.evidence_added', 'task.completed', 'task.recompleted')
    union all
    select s.task_id from public.live_activity_segments s
    where s.workspace_id = p_ws and s.user_id = p_user and s.kind = 'task' and s.voided_at is null
      and s.started_at < upper(p_range) and coalesce(s.ended_at, 'infinity'::timestamptz) > lower(p_range)
      and not isempty(app.clip(s.started_at, s.ended_at, p_range, p_live))
    union all
    select e.task_id from public.task_time_entries e
    where e.workspace_id = p_ws and e.user_id = p_user and e.voided_at is null
      and e.started_at < upper(p_range) and coalesce(e.ended_at, 'infinity'::timestamptz) > lower(p_range)
      and not isempty(app.clip(e.started_at, e.ended_at, p_range, p_live))
  ) x
  join public.tasks t on t.id = x.task_id and t.assignee_id = p_user
$$;

-- Tracked effort of a task and its subtasks, counted once (union of live task activity and time entries).
create or replace function app.effort_seconds(p_task uuid, p_range tstzrange default null, p_live boolean default true)
returns integer
language sql stable security definer set search_path = '' as $$
  with ids as (select id from public.tasks where id = p_task or parent_task_id = p_task),
  iv as (
    select app.clip(s.started_at, s.ended_at, coalesce(p_range, '(,)'::tstzrange), p_live) r
    from public.live_activity_segments s where s.task_id in (select id from ids) and s.voided_at is null
    union all
    select app.clip(e.started_at, e.ended_at, coalesce(p_range, '(,)'::tstzrange), p_live)
    from public.task_time_entries e where e.task_id in (select id from ids) and e.voided_at is null
  )
  select app.mr_seconds(range_agg(r)) from iv
$$;

-- Weeks whose Friday falls inside [p_from, p_to] (Decision 53), with frozen or provisional figures.
create or replace function app.weeks_by_friday(p_ws uuid, p_user uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_week date := app.week_start_of(p_from + ((5 - extract(dow from p_from)::integer + 7) % 7));
  v_weeks jsonb := '[]'::jsonb;
  v_sum jsonb;
  v_ot integer := 0;
  v_reg integer := 0;
  v_final boolean := true;
begin
  while v_week + 6 <= p_to loop
    v_sum := app.week_summary(p_ws, p_user, v_week);
    v_weeks := v_weeks || jsonb_build_object(
      'week_start', v_week,
      'closed', v_sum -> 'closure' is not null and v_sum -> 'closure' <> 'null'::jsonb,
      'target_seconds', (v_sum ->> 'target_seconds')::integer,
      'closed_seconds', (v_sum ->> 'closed_seconds')::integer,
      'regular_seconds', (v_sum ->> 'regular_seconds')::integer,
      'overtime_seconds', (v_sum ->> 'overtime_seconds')::integer,
      'adjustment_regular_seconds', (v_sum ->> 'net_regular_seconds')::integer - (v_sum ->> 'regular_seconds')::integer,
      'adjustment_overtime_seconds', (v_sum ->> 'net_overtime_seconds')::integer - (v_sum ->> 'overtime_seconds')::integer,
      'net_regular_seconds', (v_sum ->> 'net_regular_seconds')::integer,
      'net_overtime_seconds', (v_sum ->> 'net_overtime_seconds')::integer);
    v_ot := v_ot + (v_sum ->> 'net_overtime_seconds')::integer;
    v_reg := v_reg + (v_sum ->> 'net_regular_seconds')::integer;
    if v_sum -> 'closure' is null or v_sum -> 'closure' = 'null'::jsonb then v_final := false; end if;
    v_week := v_week + 7;
  end loop;
  return jsonb_build_object('weeks', v_weeks, 'net_overtime_seconds', v_ot, 'net_regular_seconds', v_reg, 'final', v_final);
end $$;

-- ═════════════ KPIs (ANALYTICS_SPEC.md) ═════════════
-- Every KPI carries its rule text, numerator/denominator where it is a rate, and (with p_items) the tasks behind it.
-- p_live = false leaves out still-running intervals, so a report's fingerprint depends on recorded data only.
create or replace function app.kpis(
  p_ws uuid, p_user uuid, p_from date, p_to date, p_filters jsonb default '{}', p_items boolean default true, p_live boolean default true
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_range tstzrange := app.day_range(p_ws, p_from, p_to);
  v_cut timestamptz := least(now(), upper(app.day_range(p_ws, p_from, p_to)));
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  r jsonb := '{}'::jsonb;
  v jsonb;
  v_att jsonb;
begin
  -- Throughput: distinct tasks first completed in the period. Headline excludes subtasks (Decisions 46, 52).
  select jsonb_build_object(
    'value', count(*) filter (where t.parent_task_id is null),
    'subtasks', count(*) filter (where t.parent_task_id is not null),
    'rule', 'Distinct tasks whose first completion falls in the period. Reopened tasks are not counted again. Subtasks are counted separately; archived tasks are excluded.',
    'items', case when p_items then coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'completed_at', t.first_completed_at, 'category', c.name,
        'calendar_days', round((extract(epoch from t.first_completed_at - coalesce(t.started_at, t.created_at)) / 86400)::numeric, 1),
        'effort_seconds', app.effort_seconds(t.id, null, p_live))
        order by t.first_completed_at) filter (where t.parent_task_id is null), '[]'::jsonb) else '[]'::jsonb end)
  into v
  from public.tasks t left join public.categories c on c.id = t.category_id
  where t.workspace_id = p_ws and t.assignee_id = p_user and t.archived_at is null
    and t.first_completed_at <@ v_range and app.task_matches(t, f);
  r := r || jsonb_build_object('throughput', v);

  -- Worked on (Decision 49). A subtask's activity also marks its parent as worked on; subtasks are listed separately.
  with w as (select task_id from app.worked_task_ids(p_ws, p_user, v_range, p_live)),
  heads as (
    select distinct p.id, p.title, c.name as category
    from w join public.tasks t on t.id = w.task_id
    join public.tasks p on p.id = coalesce(t.parent_task_id, t.id)
    left join public.categories c on c.id = p.category_id
    where p.archived_at is null and app.task_matches(p, f)
  ),
  subs as (
    select t.id from w join public.tasks t on t.id = w.task_id
    where t.parent_task_id is not null and t.archived_at is null and app.task_matches(t, f)
  )
  select jsonb_build_object(
    'value', (select count(*) from heads),
    'subtasks', (select count(*) from subs),
    'rule', 'Tasks with your own progress, deliverable or completion activity, or tracked task time, in the period. Title, rank, priority or deadline edits alone do not count.',
    'items', case when p_items then coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'category', category) order by title) from heads), '[]'::jsonb) else '[]'::jsonb end)
  into v;
  r := r || jsonb_build_object('worked_on', v);

  -- Due-task completion (Decision 50): due in the period by the latest effective deadline; not-yet-due tasks excluded.
  select jsonb_build_object(
    'numerator', count(*) filter (where t.status <> 'cancelled' and (t.current_due_at <= v_cut or t.first_completed_at is not null) and t.first_completed_at is not null),
    'denominator', count(*) filter (where t.status <> 'cancelled' and (t.current_due_at <= v_cut or t.first_completed_at is not null)),
    'not_yet_due', count(*) filter (where t.status <> 'cancelled' and t.current_due_at > v_cut and t.first_completed_at is null),
    'cancelled', count(*) filter (where t.status = 'cancelled'),
    'rule', 'Tasks due in the period (latest deadline) that have been completed, out of those already due. Cancelled tasks and tasks not yet due are left out and shown separately.',
    'items', case when p_items then coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'due_at', t.current_due_at, 'completed_at', t.first_completed_at, 'status', t.status,
        'eligible', t.status <> 'cancelled' and (t.current_due_at <= v_cut or t.first_completed_at is not null))
        order by t.current_due_at), '[]'::jsonb) else '[]'::jsonb end)
  into v
  from public.tasks t
  where t.workspace_id = p_ws and t.assignee_id = p_user and t.parent_task_id is null and t.archived_at is null
    and t.current_due_at <@ v_range and app.task_matches(t, f);
  v := v || jsonb_build_object('value', case when (v ->> 'denominator')::integer > 0
         then round((v ->> 'numerator')::numeric / (v ->> 'denominator')::integer, 4) end);
  r := r || jsonb_build_object('due_completion', v);

  -- On-time at completion and on-time restated (Decisions 104, 108), over tasks first completed in the period.
  with d as (
    select t.id, t.title, t.first_completed_at, t.current_due_at, e.due_at_at_completion
    from public.tasks t
    join public.task_completion_events e on e.task_id = t.id and e.is_first_completion
    where t.workspace_id = p_ws and t.assignee_id = p_user and t.parent_task_id is null and t.archived_at is null
      and t.first_completed_at <@ v_range and app.task_matches(t, f)
  )
  select jsonb_build_object(
    'at_completion', jsonb_build_object(
      'numerator', count(*) filter (where due_at_at_completion is not null and first_completed_at <= due_at_at_completion),
      'denominator', count(*) filter (where due_at_at_completion is not null),
      'rule', 'First completion on or before the deadline that applied at that moment. Never changes afterwards.',
      'items', case when p_items then coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'completed_at', first_completed_at,
          'due_at', due_at_at_completion, 'on_time', first_completed_at <= due_at_at_completion) order by first_completed_at)
          filter (where due_at_at_completion is not null), '[]'::jsonb) else '[]'::jsonb end),
    'restated', jsonb_build_object(
      'numerator', count(*) filter (where current_due_at is not null and first_completed_at <= current_due_at),
      'denominator', count(*) filter (where current_due_at is not null),
      'rule', 'First completion compared with the latest deadline, including deadlines changed after a reopen. Labelled "restated".',
      'evaluated_at', case when p_live then now() end,
      'items', case when p_items then coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'completed_at', first_completed_at,
          'due_at', current_due_at, 'on_time', first_completed_at <= current_due_at) order by first_completed_at)
          filter (where current_due_at is not null), '[]'::jsonb) else '[]'::jsonb end,
      'diverging', coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'title', title, 'completed_at', first_completed_at, 'due_at_completion', due_at_at_completion, 'due_at_latest', current_due_at,
          'changes', (select coalesce(jsonb_agg(jsonb_build_object('from', dc.from_due_at, 'to', dc.to_due_at, 'reason', dc.reason,
                        'by', app.display_name(dc.actor_id), 'at', dc.changed_at) order by dc.changed_at), '[]'::jsonb)
                      from public.deadline_changes dc where dc.task_id = d.id and dc.changed_at > d.first_completed_at))
          order by first_completed_at)
        filter (where due_at_at_completion is not null and current_due_at is not null
                and (first_completed_at <= due_at_at_completion) <> (first_completed_at <= current_due_at)), '[]'::jsonb)))
  into v from d;
  r := r || jsonb_build_object(
    'on_time_at_completion', (v -> 'at_completion') || jsonb_build_object('value', case when (v -> 'at_completion' ->> 'denominator')::integer > 0
      then round((v -> 'at_completion' ->> 'numerator')::numeric / (v -> 'at_completion' ->> 'denominator')::integer, 4) end),
    'on_time_restated', (v -> 'restated') || jsonb_build_object('value', case when (v -> 'restated' ->> 'denominator')::integer > 0
      then round((v -> 'restated' ->> 'numerator')::numeric / (v -> 'restated' ->> 'denominator')::integer, 4) end));

  -- Expected-deliverable fulfillment at first completion (Not applicable excluded).
  with e as (
    select t.id, t.title, d ->> 'status' as st
    from public.tasks t
    join public.task_completion_events ev on ev.task_id = t.id and ev.is_first_completion
    cross join lateral jsonb_array_elements(ev.deliverable_snapshot) d
    where t.workspace_id = p_ws and t.assignee_id = p_user and t.parent_task_id is null and t.archived_at is null
      and t.first_completed_at <@ v_range and app.task_matches(t, f)
      and d ->> 'kind' = 'expected' and d ->> 'archived_at' is null
  ), per as (
    select id, title, count(*) filter (where st = 'delivered') delivered, count(*) filter (where st <> 'not_applicable') applicable
    from e group by id, title
  )
  select jsonb_build_object(
    'numerator', coalesce(sum(delivered), 0), 'denominator', coalesce(sum(applicable), 0),
    'value', case when coalesce(sum(applicable), 0) > 0 then round(sum(delivered)::numeric / sum(applicable), 4) end,
    'rule', 'Expected deliverables marked Delivered in the first-completion snapshot, out of those not marked Not applicable.',
    'items', case when p_items then coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'delivered', delivered, 'applicable', applicable) order by title), '[]'::jsonb) else '[]'::jsonb end)
  into v from per;
  r := r || jsonb_build_object('deliverable_fulfillment', v);

  -- Proactive work (Decision 05): employee-initiated tasks created in the period, and how many are completed.
  select jsonb_build_object(
    'created', count(*), 'completed', count(*) filter (where t.first_completed_at is not null),
    'rule', 'Top-level tasks you created yourself in the period; "completed" counts those completed at any time since.',
    'items', case when p_items then coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'created_at', t.created_at, 'status', t.status) order by t.created_at), '[]'::jsonb) else '[]'::jsonb end)
  into v
  from public.tasks t
  where t.workspace_id = p_ws and t.assignee_id = p_user and t.parent_task_id is null and t.archived_at is null
    and t.origin = 'employee_initiative' and t.created_at <@ v_range and app.task_matches(t, f);
  r := r || jsonb_build_object('proactive', v);

  -- Extra deliverables by who initiated them (Decision 16), by date added.
  select jsonb_build_object(
    'self_initiated', count(*) filter (where d.origin = 'self_initiated'),
    'manager_requested', count(*) filter (where d.origin = 'manager_requested'),
    'rule', 'Extra deliverables added in the period, by who initiated them.',
    'items', case when p_items then coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'task_id', t.id, 'task', t.title,
        'origin', d.origin, 'status', d.status, 'added_at', d.added_at) order by d.added_at), '[]'::jsonb) else '[]'::jsonb end)
  into v
  from public.deliverables d join public.tasks t on t.id = d.task_id
  where t.workspace_id = p_ws and t.assignee_id = p_user and d.kind = 'extra' and d.archived_at is null
    and d.added_at <@ v_range and app.task_matches(t, f);
  r := r || jsonb_build_object('extras', v);

  -- Reopen events (revision rounds vs additional scope).
  select jsonb_build_object(
    'revision', count(*) filter (where e.action = 'reopen_revision'),
    'additional_scope', count(*) filter (where e.action = 'reopen_additional_scope'),
    'rule', 'Reopen events in the period. They never add to throughput.',
    'items', case when p_items then coalesce(jsonb_agg(jsonb_build_object('task_id', t.id, 'task', t.title, 'mode', replace(e.action, 'reopen_', ''),
        'reason', e.reason, 'at', e.occurred_at) order by e.occurred_at), '[]'::jsonb) else '[]'::jsonb end)
  into v
  from public.task_status_events e join public.tasks t on t.id = e.task_id
  where t.workspace_id = p_ws and t.assignee_id = p_user and e.action like 'reopen\_%' and e.occurred_at <@ v_range and app.task_matches(t, f);
  r := r || jsonb_build_object('reopens', v);

  -- Deadline changes and their documented reasons (Decision 54).
  select jsonb_build_object(
    'count', count(*),
    'rule', 'Every deadline change made in the period, with its reason. Original deadlines are never overwritten.',
    'items', case when p_items then coalesce(jsonb_agg(jsonb_build_object('task_id', t.id, 'task', t.title, 'from', dc.from_due_at, 'to', dc.to_due_at,
        'reason', dc.reason, 'by', app.display_name(dc.actor_id), 'at', dc.changed_at) order by dc.changed_at), '[]'::jsonb) else '[]'::jsonb end)
  into v
  from public.deadline_changes dc join public.tasks t on t.id = dc.task_id
  where t.workspace_id = p_ws and t.assignee_id = p_user and dc.changed_at <@ v_range and app.task_matches(t, f);
  r := r || jsonb_build_object('deadline_changes', v);

  -- Attendance: closed hours in the period, unassigned time, overtime by Friday rule (Decision 53).
  v_att := app.weeks_by_friday(p_ws, p_user, p_from, p_to);
  r := r || jsonb_build_object('attendance', jsonb_build_object(
    'closed_seconds', app.closed_union_seconds(p_ws, p_user, v_range),
    'unassigned_seconds', (select app.mr_seconds(range_agg(app.clip(s.started_at, s.ended_at, v_range, p_live)))
                           from public.live_activity_segments s
                           where s.workspace_id = p_ws and s.user_id = p_user and s.kind = 'unassigned' and s.voided_at is null
                             and s.started_at < upper(v_range) and coalesce(s.ended_at, 'infinity'::timestamptz) > lower(v_range)),
    'overtime_seconds', (v_att ->> 'net_overtime_seconds')::integer,
    'regular_seconds', (v_att ->> 'net_regular_seconds')::integer,
    'final', (v_att ->> 'final')::boolean,
    'weeks', v_att -> 'weeks',
    'rule', 'Closed attendance only. Overtime is counted per Saturday–Friday week, in the month of that week''s Friday, including adjustments posted into those weeks.'));

  if p_items then
    -- Category and work-type breakdowns (Decisions 48, 51): calendar days and tracked hours kept separate.
    with w as (select task_id from app.worked_task_ids(p_ws, p_user, v_range, p_live)),
    heads as (
      select distinct coalesce(t.parent_task_id, t.id) as id from w join public.tasks t on t.id = w.task_id
    ),
    base as (
      select t.*, c.name as category_name,
             t.first_completed_at <@ v_range as done_in_period,
             t.id in (select id from heads) as worked,
             app.effort_seconds(t.id, v_range, p_live) as effort_in_period,
             coalesce((select sum(hold_seconds) from public.task_status_events h where h.task_id = t.id and h.action = 'resume'), 0) as hold_seconds
      from public.tasks t left join public.categories c on c.id = t.category_id
      where t.workspace_id = p_ws and t.assignee_id = p_user and t.parent_task_id is null and t.archived_at is null
        and app.task_matches(t, f)
        and (t.first_completed_at <@ v_range or t.id in (select id from heads))
    )
    select jsonb_build_object(
      'by_category', coalesce((select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object('category_id', category_id, 'name', coalesce(category_name, 'Uncategorized'),
          'throughput', count(*) filter (where done_in_period),
          'worked_on', count(*) filter (where worked),
          'avg_calendar_days', round(avg(extract(epoch from first_completed_at - coalesce(started_at, created_at)) / 86400) filter (where done_in_period)::numeric, 1),
          'avg_hold_days', round(avg(hold_seconds / 86400.0) filter (where done_in_period)::numeric, 1),
          'tracked_seconds', coalesce(sum(effort_in_period), 0)) x
        from base group by category_id, category_name) q), '[]'::jsonb),
      'by_work_type', coalesce((select jsonb_agg(x order by x ->> 'work_type') from (
        select jsonb_build_object('work_type', work_type,
          'throughput', count(*) filter (where done_in_period),
          'worked_on', count(*) filter (where worked),
          'avg_calendar_days', round(avg(extract(epoch from first_completed_at - coalesce(started_at, created_at)) / 86400) filter (where done_in_period)::numeric, 1),
          'tracked_seconds', coalesce(sum(effort_in_period), 0)) x
        from base group by work_type) q), '[]'::jsonb),
      'breakdown_rule', 'Calendar days = first completion minus start (includes holds) for tasks completed in the period. Tracked hours = task time inside the period, counted once per task including its subtasks.')
    into v;
    r := r || v;
  end if;

  return r || jsonb_build_object('period', jsonb_build_object('from', p_from, 'to', p_to), 'filters', f);
end $$;

create or replace function public.get_analytics(p_workspace uuid, p_user uuid, p_from date, p_to date, p_filters jsonb default '{}')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_trend jsonb := '[]'::jsonb;
  v_month date;
  k jsonb;
begin
  if not app.can_view_user_work(p_workspace, p_user) then perform app.raise('HZ404', 'Not found.'); end if;
  if p_from is null or p_to is null or p_to < p_from then perform app.raise('HZ422', 'Choose a valid date range.'); end if;
  if p_to - p_from > 366 then perform app.raise('HZ422', 'Choose a range of one year or less.'); end if;

  -- Six-month trend ending with the month of p_to (Decision 48).
  for i in reverse 5..0 loop
    v_month := (date_trunc('month', p_to) - make_interval(months => i))::date;
    k := app.kpis(p_workspace, p_user, v_month, (v_month + interval '1 month' - interval '1 day')::date, p_filters, false, true);
    v_trend := v_trend || jsonb_build_object(
      'month', to_char(v_month, 'YYYY-MM'),
      'throughput', (k -> 'throughput' ->> 'value')::integer,
      'worked_on', (k -> 'worked_on' ->> 'value')::integer,
      'due_completion', (k -> 'due_completion' ->> 'value')::numeric,
      'on_time_at_completion', (k -> 'on_time_at_completion' ->> 'value')::numeric,
      'on_time_restated', (k -> 'on_time_restated' ->> 'value')::numeric,
      'overtime_seconds', (k -> 'attendance' ->> 'overtime_seconds')::integer,
      'closed_seconds', (k -> 'attendance' ->> 'closed_seconds')::integer);
  end loop;

  return jsonb_build_object('as_of', now(), 'kpis', app.kpis(p_workspace, p_user, p_from, p_to, p_filters, true, true), 'trend', v_trend);
end $$;

-- ═════════════ Calendar (Decision 106) ═════════════
create or replace function app.day_state(p_ws uuid, p_user uuid, p_date date) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_date > app.local_date(p_ws, now()) then 'future'
    when not exists (select 1 from public.workspace_members m where m.workspace_id = p_ws and m.user_id = p_user
                       and m.active_from <= p_date and (m.active_to is null or m.active_to >= p_date)) then 'outside_membership'
    else 'recorded' end
$$;

-- 42-day grid (6 Saturday-first weeks) covering the month, one compact summary per day.
create or replace function public.get_month_calendar(p_workspace uuid, p_user uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_first date := date_trunc('month', p_month)::date;
  v_start date := app.week_start_of(date_trunc('month', p_month)::date);
  v_today date;
  v_working smallint[];
begin
  if not app.can_view_user_work(p_workspace, p_user) then perform app.raise('HZ404', 'Not found.'); end if;
  v_today := app.local_date(p_workspace, now());
  return jsonb_build_object(
    'month', to_char(v_first, 'YYYY-MM'),
    'today', v_today,
    'days', (
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'in_month', date_trunc('month', d.day) = v_first,
        'is_today', d.day = v_today,
        'state', app.day_state(p_workspace, p_user, d.day),
        'working_day', extract(dow from d.day)::smallint = any (coalesce((app.target_settings(p_workspace, app.week_start_of(d.day))).working_days, '{0,1,2,3,4}')),
        'closed_seconds', app.closed_union_seconds(p_workspace, p_user, d.rng),
        'live_seconds', app.open_session_seconds(p_workspace, p_user, d.rng),
        'unassigned_seconds', (select app.mr_seconds(range_agg(app.clip(s.started_at, s.ended_at, d.rng, true)))
                               from public.live_activity_segments s
                               where s.workspace_id = p_workspace and s.user_id = p_user and s.kind = 'unassigned' and s.voided_at is null
                                 and s.started_at < upper(d.rng) and coalesce(s.ended_at, 'infinity'::timestamptz) > lower(d.rng)),
        'worked_count', (select count(*) from app.worked_task_ids(p_workspace, p_user, d.rng, true)),
        'completions', (select count(*) from public.task_completion_events e join public.tasks t on t.id = e.task_id
                        where t.workspace_id = p_workspace and t.assignee_id = p_user and e.completed_at <@ d.rng),
        'due_count', (select count(*) from public.tasks t
                      where t.workspace_id = p_workspace and t.assignee_id = p_user and t.archived_at is null
                        and t.status in ('not_started', 'in_progress', 'on_hold') and t.current_due_at <@ d.rng),
        'week_closed', exists (select 1 from public.week_closures w where w.workspace_id = p_workspace and w.user_id = p_user
                                 and w.week_start = app.week_start_of(d.day)),
        'week_corrected', exists (select 1 from public.payroll_adjustments a where a.workspace_id = p_workspace and a.user_id = p_user
                                    and a.source_week_start = app.week_start_of(d.day))
      ) order by d.day)
      from (select g::date as day, app.day_range(p_workspace, g::date) as rng
            from generate_series(v_start, v_start + 41, interval '1 day') g) d
    ));
end $$;

-- Everything recorded for one local day (CALENDAR_SPEC.md). p_frozen leaves out open sessions and running intervals.
create or replace function app.day_summary(p_ws uuid, p_user uuid, p_date date, p_frozen boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_range tstzrange := app.day_range(p_ws, p_date);
  v_live boolean := not p_frozen;
  v_state text := app.day_state(p_ws, p_user, p_date);
  v_sessions jsonb;
  v_segments jsonb;
  v_entries jsonb;
  v_tasks jsonb;
  v_events jsonb;
  v_due jsonb;
  v_totals jsonb;
  v_week jsonb;
  v_att tstzmultirange;
  v_ent tstzmultirange;
  v_week_start date := app.week_start_of(p_date);
  c public.week_closures;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'started_at', a.started_at, 'ended_at', a.ended_at, 'open', a.ended_at is null, 'origin', a.origin, 'summary', a.summary,
      'corrected', exists (select 1 from public.audit_events x where x.entity_id = a.id and x.event_type = 'attendance.corrected'),
      'from', lower(app.clip(a.started_at, a.ended_at, v_range, true)), 'to', upper(app.clip(a.started_at, a.ended_at, v_range, true)),
      'seconds', app.mr_seconds(tstzmultirange(app.clip(a.started_at, a.ended_at, v_range, v_live))),
      'starts_previous_day', a.started_at < lower(v_range), 'continues_next_day', coalesce(a.ended_at, 'infinity'::timestamptz) > upper(v_range))
      order by a.started_at), '[]'::jsonb)
  into v_sessions
  from public.attendance_sessions a
  where a.workspace_id = p_ws and a.user_id = p_user and a.voided_at is null
    and a.started_at < upper(v_range) and coalesce(a.ended_at, 'infinity'::timestamptz) > lower(v_range)
    and (v_live or a.ended_at is not null);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'attendance_session_id', s.attendance_session_id, 'kind', s.kind, 'task_id', s.task_id, 'general_type', s.general_type,
      'task', t.title, 'parent_task_id', t.parent_task_id, 'parent', p.title, 'open', s.ended_at is null,
      'relabelled', s.split_from is not null,
      'from', lower(app.clip(s.started_at, s.ended_at, v_range, true)), 'to', upper(app.clip(s.started_at, s.ended_at, v_range, true)),
      'seconds', app.mr_seconds(tstzmultirange(app.clip(s.started_at, s.ended_at, v_range, v_live))))
      order by s.started_at), '[]'::jsonb)
  into v_segments
  from public.live_activity_segments s
  left join public.tasks t on t.id = s.task_id
  left join public.tasks p on p.id = t.parent_task_id
  where s.workspace_id = p_ws and s.user_id = p_user and s.voided_at is null
    and s.started_at < upper(v_range) and coalesce(s.ended_at, 'infinity'::timestamptz) > lower(v_range)
    and (v_live or s.ended_at is not null)
    and not isempty(app.clip(s.started_at, s.ended_at, v_range, true));

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'task_id', e.task_id, 'task', t.title, 'source', e.source, 'open', e.ended_at is null, 'note', e.note,
      'overlap', e.overlap_acknowledged,
      'from', lower(app.clip(e.started_at, e.ended_at, v_range, true)), 'to', upper(app.clip(e.started_at, e.ended_at, v_range, true)),
      'seconds', app.mr_seconds(tstzmultirange(app.clip(e.started_at, e.ended_at, v_range, v_live))))
      order by e.started_at), '[]'::jsonb)
  into v_entries
  from public.task_time_entries e join public.tasks t on t.id = e.task_id
  where e.workspace_id = p_ws and e.user_id = p_user and e.voided_at is null
    and e.started_at < upper(v_range) and coalesce(e.ended_at, 'infinity'::timestamptz) > lower(v_range)
    and (v_live or e.ended_at is not null)
    and not isempty(app.clip(e.started_at, e.ended_at, v_range, true));

  select coalesce(range_agg(app.clip(a.started_at, a.ended_at, v_range, v_live)), '{}'::tstzmultirange) into v_att
  from public.attendance_sessions a
  where a.workspace_id = p_ws and a.user_id = p_user and a.voided_at is null
    and a.started_at < upper(v_range) and coalesce(a.ended_at, 'infinity'::timestamptz) > lower(v_range);
  select coalesce(range_agg(app.clip(e.started_at, e.ended_at, v_range, v_live)), '{}'::tstzmultirange) into v_ent
  from public.task_time_entries e
  where e.workspace_id = p_ws and e.user_id = p_user and e.voided_at is null
    and e.started_at < upper(v_range) and coalesce(e.ended_at, 'infinity'::timestamptz) > lower(v_range);

  select jsonb_build_object(
    'closed_seconds', app.closed_union_seconds(p_ws, p_user, v_range),
    'provisional_seconds', case when v_live then app.open_session_seconds(p_ws, p_user, v_range) else 0 end,
    'task_seconds', coalesce(app.mr_seconds(range_agg(app.clip(s.started_at, s.ended_at, v_range, v_live)) filter (where s.kind = 'task')), 0),
    'general_seconds', coalesce(app.mr_seconds(range_agg(app.clip(s.started_at, s.ended_at, v_range, v_live)) filter (where s.kind = 'general')), 0),
    'unassigned_seconds', coalesce(app.mr_seconds(range_agg(app.clip(s.started_at, s.ended_at, v_range, v_live)) filter (where s.kind = 'unassigned')), 0),
    'standalone_seconds', app.mr_seconds(v_ent),
    'standalone_outside_attendance_seconds', app.mr_seconds(v_ent - v_att))
  into v_totals
  from public.live_activity_segments s
  where s.workspace_id = p_ws and s.user_id = p_user and s.voided_at is null
    and s.started_at < upper(v_range) and coalesce(s.ended_at, 'infinity'::timestamptz) > lower(v_range);

  with w as (select task_id from app.worked_task_ids(p_ws, p_user, v_range, v_live))
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'parent_task_id', t.parent_task_id, 'parent', p.title, 'status', t.status,
      'seconds', (select app.mr_seconds(range_agg(r)) from (
          select app.clip(s.started_at, s.ended_at, v_range, v_live) r from public.live_activity_segments s
          where s.task_id = t.id and s.voided_at is null and s.started_at < upper(v_range) and coalesce(s.ended_at, 'infinity'::timestamptz) > lower(v_range)
          union all
          select app.clip(e.started_at, e.ended_at, v_range, v_live) from public.task_time_entries e
          where e.task_id = t.id and e.voided_at is null and e.started_at < upper(v_range) and coalesce(e.ended_at, 'infinity'::timestamptz) > lower(v_range)) q),
      'progress', (select coalesce(jsonb_agg(jsonb_build_object('at', a.occurred_at, 'from', a.old_json -> 'progress', 'to', a.new_json -> 'progress') order by a.occurred_at), '[]'::jsonb)
                   from public.audit_events a where a.task_id = t.id and a.event_type = 'task.progress_updated' and a.occurred_at <@ v_range),
      'deliverables', (select coalesce(jsonb_agg(jsonb_build_object('at', a.occurred_at, 'summary', a.summary) order by a.occurred_at), '[]'::jsonb)
                       from public.audit_events a where a.task_id = t.id and a.event_type like 'deliverable.%' and a.actor_id = p_user and a.occurred_at <@ v_range),
      'completions', (select coalesce(jsonb_agg(jsonb_build_object('at', e.completed_at, 'first', e.is_first_completion) order by e.completed_at), '[]'::jsonb)
                      from public.task_completion_events e where e.task_id = t.id and e.completed_at <@ v_range))
      order by coalesce(p.title, t.title), t.parent_task_id nulls first, t.title), '[]'::jsonb)
  into v_tasks
  from w join public.tasks t on t.id = w.task_id left join public.tasks p on p.id = t.parent_task_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'at', a.occurred_at, 'type', a.event_type, 'summary', a.summary,
      'by', app.display_name(a.actor_id), 'task_id', a.task_id, 'body', a.metadata_json ->> 'body') order by a.occurred_at), '[]'::jsonb)
  into v_events
  from (
    select * from public.audit_events a
    where a.workspace_id = p_ws and a.subject_user_id = p_user and a.occurred_at <@ v_range
      and a.event_type not in ('activity.switched', 'attendance.clock_in', 'attendance.clock_out', 'time.timer_started', 'time.timer_stopped',
                               'task.progress_updated', 'deliverable.status_changed', 'task.generated', 'report.created', 'report.generated')
    order by a.occurred_at limit 200
  ) a;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_at', t.current_due_at,
      'completed_at', t.first_completed_at, 'parent_task_id', t.parent_task_id) order by t.current_due_at), '[]'::jsonb)
  into v_due
  from public.tasks t
  where t.workspace_id = p_ws and t.assignee_id = p_user and t.archived_at is null and t.current_due_at <@ v_range;

  select * into c from public.week_closures where workspace_id = p_ws and user_id = p_user and week_start = v_week_start;
  v_week := jsonb_build_object(
    'week_start', v_week_start,
    'closed', c.id is not null,
    'closed_at', c.closed_at,
    'regular_seconds', c.regular_seconds,
    'overtime_seconds', c.overtime_seconds,
    'adjustments_out', (select coalesce(jsonb_agg(jsonb_build_object('posted_week_start', a.posted_week_start,
        'regular_delta_seconds', a.regular_delta_seconds, 'overtime_delta_seconds', a.overtime_delta_seconds, 'created_at', a.created_at)
        order by a.created_at), '[]'::jsonb)
      from public.payroll_adjustments a where a.workspace_id = p_ws and a.user_id = p_user and a.source_week_start = v_week_start));

  if v_state = 'recorded' and v_sessions = '[]'::jsonb and v_segments = '[]'::jsonb and v_entries = '[]'::jsonb
     and v_tasks = '[]'::jsonb and v_events = '[]'::jsonb then
    v_state := 'no_recorded_work';
  end if;

  return jsonb_build_object(
    'date', p_date, 'state', v_state, 'starts_at', lower(v_range), 'ends_at', upper(v_range),
    'hours_in_day', round((extract(epoch from upper(v_range) - lower(v_range)) / 3600)::numeric, 2),
    'sessions', v_sessions, 'segments', v_segments, 'entries', v_entries, 'totals', v_totals,
    'tasks', v_tasks, 'events', v_events, 'due', v_due, 'week', v_week);
end $$;

create or replace function public.get_day_summary(p_workspace uuid, p_user uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid();
begin
  if not app.can_view_user_work(p_workspace, p_user) then perform app.raise('HZ404', 'Not found.'); end if;
  return app.day_summary(p_workspace, p_user, p_date, false);
end $$;

revoke all on all functions in schema public from public, anon;
grant execute on function
  public.get_analytics(uuid, uuid, date, date, jsonb),
  public.get_month_calendar(uuid, uuid, date),
  public.get_day_summary(uuid, uuid, date),
  public.get_week_summary(uuid, uuid, date),
  public.get_month_overtime(uuid, uuid, date)
to authenticated;
