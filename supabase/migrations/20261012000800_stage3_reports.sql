-- Hobzerve Stage 3 (part 3) — report snapshots (Decisions 88–91, 111).
-- A snapshot freezes the report's source data and its SHA-256 fingerprint at generation time. The PDF is rendered from
-- the frozen data on download, so the same snapshot always produces the same document. Raw records are never exported.

create table public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly', 'monthly', 'task', 'project')),
  subject_user_id uuid not null references public.profiles (id),
  task_id uuid references public.tasks (id),
  period_start date,
  period_end date,
  filters jsonb not null default '{}'::jsonb,
  title text not null,
  source jsonb not null,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  renderer_version text not null default '1',
  auto boolean not null default false,
  created_by uuid references public.profiles (id),
  generated_at timestamptz not null default now(),
  check ((kind in ('task', 'project')) = (task_id is not null)),
  check (kind in ('task', 'project') or (period_start is not null and period_end is not null and period_end >= period_start))
);
create index on public.report_snapshots (workspace_id, subject_user_id, generated_at desc);
-- One automatic weekly/monthly snapshot per person and period (A32).
create unique index report_snapshots_auto_unique on public.report_snapshots (workspace_id, subject_user_id, kind, period_start) where auto;

create trigger report_snapshots_append_only before update or delete on public.report_snapshots
  for each row execute function app.forbid_mutation();

alter table public.report_snapshots enable row level security;
create policy report_snapshots_read on public.report_snapshots for select to authenticated
  using (app.can_view_user_work(workspace_id, subject_user_id));
revoke all on public.report_snapshots from anon;
revoke insert, update, delete, truncate on public.report_snapshots from authenticated;
grant select on public.report_snapshots to authenticated;

-- ═════════════ Report sources ═════════════
create or replace function app.task_report(p_task uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status, 'queue', t.queue,
    'progress', t.manual_progress, 'priority_level', t.priority_level, 'work_type', t.work_type, 'complexity', t.complexity,
    'origin', t.origin, 'category', c.name, 'labels', to_jsonb(t.labels), 'assignee', app.display_name(t.assignee_id),
    'creator', app.display_name(t.creator_id), 'created_at', t.created_at, 'started_at', t.started_at,
    'first_completed_at', t.first_completed_at, 'original_due_at', t.original_due_at, 'current_due_at', t.current_due_at,
    'estimated_minutes', t.estimated_minutes, 'archived', t.archived_at is not null,
    'parent', (select jsonb_build_object('id', p.id, 'title', p.title) from public.tasks p where p.id = t.parent_task_id),
    'effort_seconds', app.effort_seconds(t.id, null, false),
    'direct_effort_seconds', (select app.mr_seconds(range_agg(r)) from (
        select app.clip(s.started_at, s.ended_at, '(,)'::tstzrange, false) r from public.live_activity_segments s where s.task_id = t.id and s.voided_at is null
        union all
        select app.clip(e.started_at, e.ended_at, '(,)'::tstzrange, false) from public.task_time_entries e where e.task_id = t.id and e.voided_at is null) q),
    'deadline_changes', (select coalesce(jsonb_agg(jsonb_build_object('from', d.from_due_at, 'to', d.to_due_at, 'reason', d.reason,
        'by', app.display_name(d.actor_id), 'at', d.changed_at) order by d.changed_at), '[]'::jsonb)
        from public.deadline_changes d where d.task_id = t.id),
    'completions', (select coalesce(jsonb_agg(jsonb_build_object('at', e.completed_at, 'first', e.is_first_completion,
        'due_at', e.due_at_at_completion, 'on_time', case when e.due_at_at_completion is null then null else e.completed_at <= e.due_at_at_completion end,
        'progress', e.progress_at_completion, 'note', e.note,
        'missing', (select coalesce(jsonb_agg(v) , '[]'::jsonb) from jsonb_each(e.missing_deliverable_reasons) x(k, v)),
        'unfinished_subtasks', (select coalesce(jsonb_agg(v), '[]'::jsonb) from jsonb_each(e.unfinished_subtask_reasons) x(k, v)))
        order by e.completed_at), '[]'::jsonb)
        from public.task_completion_events e where e.task_id = t.id),
    'deliverables', (select coalesce(jsonb_agg(jsonb_build_object('title', d.title, 'kind', d.kind, 'origin', d.origin, 'status', d.status,
        'cycle', sc.sequence, 'delivered_at', d.delivered_at, 'archived', d.archived_at is not null,
        'evidence', (select coalesce(jsonb_agg(jsonb_build_object('url', ev.url, 'note', ev.note) order by ev.created_at), '[]'::jsonb)
                     from public.deliverable_evidence ev where ev.deliverable_id = d.id))
        order by sc.sequence, d.added_at), '[]'::jsonb)
        from public.deliverables d join public.scope_cycles sc on sc.id = d.scope_cycle_id where d.task_id = t.id),
    'scope_cycles', (select coalesce(jsonb_agg(jsonb_build_object('sequence', s.sequence, 'type', s.type, 'reason', s.reason,
        'opened_at', s.opened_at, 'closed_at', s.closed_at) order by s.sequence), '[]'::jsonb)
        from public.scope_cycles s where s.task_id = t.id),
    'revision_rounds', (select coalesce(jsonb_agg(jsonb_build_object('sequence', r.sequence, 'reason', r.reason,
        'opened_at', r.opened_at, 'closed_at', r.closed_at) order by r.opened_at), '[]'::jsonb)
        from public.revision_rounds r where r.task_id = t.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('at', a.occurred_at, 'summary', a.summary, 'by', app.display_name(a.actor_id),
        'body', a.metadata_json ->> 'body') order by a.occurred_at), '[]'::jsonb)
        from (select * from public.audit_events a where a.task_id = t.id
              and a.event_type not in ('activity.switched', 'time.timer_started', 'time.timer_stopped', 'report.created', 'report.generated')
              order by a.occurred_at limit 500) a),
    'subtasks', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status, 'progress', s.manual_progress,
        'due_at', s.current_due_at, 'first_completed_at', s.first_completed_at, 'effort_seconds', app.effort_seconds(s.id, null, false))
        order by s.created_at), '[]'::jsonb)
        from public.tasks s where s.parent_task_id = t.id and s.archived_at is null))
  from public.tasks t left join public.categories c on c.id = t.category_id
  where t.id = p_task
$$;

-- Frozen data for a report: no open sessions or running timers, no values that move just because time passes,
-- so the fingerprint changes only when recorded data changes.
create or replace function app.report_source(
  p_ws uuid, p_kind text, p_user uuid, p_from date, p_to date, p_task uuid, p_filters jsonb
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_body jsonb;
  v_week jsonb;
  v_header jsonb;
begin
  v_header := jsonb_build_object(
    'kind', p_kind,
    'workspace', (select name from public.workspaces where id = p_ws),
    'timezone', app.ws_tz(p_ws),
    'subject', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'job_title', p.job_title) from public.profiles p where p.id = p_user),
    'period', case when p_from is null then null else jsonb_build_object('from', p_from, 'to', p_to) end,
    'filters', f,
    'filter_labels', jsonb_strip_nulls(jsonb_build_object(
      'category', (select name from public.categories where id::text = f ->> 'category_id'),
      'work_type', f ->> 'work_type', 'priority', f ->> 'priority', 'origin', f ->> 'origin', 'status', f ->> 'status')));

  if p_kind = 'daily' then
    v_body := jsonb_build_object('day', app.day_summary(p_ws, p_user, p_from, true));
  elsif p_kind = 'weekly' then
    v_week := app.week_summary(p_ws, p_user, p_from) - 'provisional_open_seconds' - 'status' - 'fingerprint_changed' - 'closes_at';
    v_body := jsonb_build_object(
      'week', v_week || jsonb_build_object('closed', v_week -> 'closure' <> 'null'::jsonb),
      'days', (select jsonb_agg(jsonb_build_object(
          'date', g::date,
          'closed_seconds', app.closed_union_seconds(p_ws, p_user, app.day_range(p_ws, g::date)),
          'worked_count', (select count(*) from app.worked_task_ids(p_ws, p_user, app.day_range(p_ws, g::date), false)))
          order by g)
        from generate_series(p_from, p_to, interval '1 day') g),
      'kpis', app.kpis(p_ws, p_user, p_from, p_to, f, true, false));
  elsif p_kind = 'monthly' then
    v_body := jsonb_build_object('kpis', app.kpis(p_ws, p_user, p_from, p_to, f, true, false));
  elsif p_kind = 'task' then
    v_body := jsonb_build_object('task', app.task_report(p_task));
  elsif p_kind = 'project' then
    v_body := jsonb_build_object(
      'task', app.task_report(p_task),
      'subtask_reports', (select coalesce(jsonb_agg(app.task_report(s.id) order by s.created_at), '[]'::jsonb)
                          from public.tasks s where s.parent_task_id = p_task and s.archived_at is null));
  else
    perform app.raise('HZ422', 'Unknown report type.');
  end if;
  return v_header || v_body;
end $$;

create or replace function app.report_fingerprint(p_source jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_source::text, 'UTF8')), 'hex')
$$;

create or replace function app.report_title(p_kind text, p_from date, p_to date, p_task uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'daily' then 'Daily report · ' || to_char(p_from, 'Dy DD Mon YYYY')
    when 'weekly' then 'Weekly report · ' || to_char(p_from, 'DD Mon') || ' – ' || to_char(p_to, 'DD Mon YYYY')
    when 'monthly' then 'Monthly report · ' || to_char(p_from, 'FMMonth YYYY')
    when 'task' then 'Task history · ' || (select title from public.tasks where id = p_task)
    when 'project' then 'Project report · ' || (select title from public.tasks where id = p_task)
  end
$$;

-- Normalizes the period for each kind and inserts the snapshot. Internal: callers check access first.
create or replace function app.create_report_snapshot(
  p_ws uuid, p_kind text, p_user uuid, p_from date, p_to date, p_task uuid, p_filters jsonb, p_actor uuid, p_auto boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_from date := p_from;
  v_to date := p_to;
  v_source jsonb;
  v_id uuid;
  v_filters jsonb := jsonb_strip_nulls(coalesce(p_filters, '{}'::jsonb));
begin
  case p_kind
    when 'daily' then
      if v_from is null then perform app.raise('HZ422', 'Choose a day.'); end if;
      v_to := v_from;
    when 'weekly' then
      if v_from is null then perform app.raise('HZ422', 'Choose a week.'); end if;
      v_from := app.week_start_of(v_from); v_to := v_from + 6;
    when 'monthly' then
      if v_from is null then perform app.raise('HZ422', 'Choose a month.'); end if;
      v_from := date_trunc('month', v_from)::date; v_to := (v_from + interval '1 month' - interval '1 day')::date;
    when 'task', 'project' then
      if p_task is null then perform app.raise('HZ422', 'Choose a task.'); end if;
      v_from := null; v_to := null; v_filters := '{}'::jsonb;
    else
      perform app.raise('HZ422', 'Unknown report type.');
  end case;
  if v_from is not null and v_from > app.local_date(p_ws, now()) then
    perform app.raise('HZ422', 'That period has not started yet.');
  end if;

  v_source := app.report_source(p_ws, p_kind, p_user, v_from, v_to, p_task, v_filters);
  insert into public.report_snapshots (workspace_id, kind, subject_user_id, task_id, period_start, period_end, filters, title,
                                       source, source_fingerprint, auto, created_by)
  values (p_ws, p_kind, p_user, p_task, v_from, v_to, v_filters, app.report_title(p_kind, v_from, v_to, p_task),
          v_source, app.report_fingerprint(v_source), p_auto, p_actor)
  on conflict (workspace_id, subject_user_id, kind, period_start) where auto do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.create_report(
  p_workspace uuid, p_kind text, p_user uuid default null, p_from date default null, p_task uuid default null, p_filters jsonb default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_subject uuid := p_user;
  t public.tasks;
  v_id uuid;
begin
  if not app.is_member(p_workspace) then perform app.raise('HZ403', 'You are not a member of this workspace.'); end if;
  if p_kind in ('task', 'project') then
    select * into t from public.tasks where id = p_task;
    if not found or t.workspace_id <> p_workspace or not app.can_view_user_work(p_workspace, t.assignee_id) then
      perform app.raise('HZ404', 'Task not found.');
    end if;
    if p_kind = 'project' and t.parent_task_id is not null then
      perform app.raise('HZ422', 'Project reports are for top-level tasks. Choose the parent task.');
    end if;
    v_subject := t.assignee_id;
  else
    v_subject := coalesce(p_user, v_uid);
    if not app.can_view_user_work(p_workspace, v_subject) or app.member_role(p_workspace, v_subject) is distinct from 'employee' then
      perform app.raise('HZ404', 'Employee not found.');
    end if;
  end if;

  v_id := app.create_report_snapshot(p_workspace, p_kind, v_subject, p_from, null, p_task, p_filters, v_uid, false);
  perform app.emit(p_workspace, v_uid, v_subject, 'report', v_id, case when p_kind in ('task', 'project') then p_task end, 'report.created',
    format('%s generated a report: %s', app.display_name(v_uid), (select title from public.report_snapshots where id = v_id)),
    null, null, '{}'::jsonb, false, '/analytics/reports', null, '{}');
  return v_id;
end $$;

-- Full snapshot (including frozen source) for rendering; access follows the subject's visibility.
create or replace function public.get_report(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  s public.report_snapshots;
begin
  select * into s from public.report_snapshots where id = p_id;
  if not found or not app.can_view_user_work(s.workspace_id, s.subject_user_id) then perform app.raise('HZ404', 'Report not found.'); end if;
  return to_jsonb(s) || jsonb_build_object('subject_name', app.display_name(s.subject_user_id),
                                           'created_by_name', case when s.created_by is null then null else app.display_name(s.created_by) end);
end $$;

-- Changed-since-export (Decision 91): recompute the source with the same parameters and compare fingerprints.
create or replace function public.report_changes(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  s public.report_snapshots;
  v_out jsonb := '[]'::jsonb;
  v_now text;
begin
  if cardinality(coalesce(p_ids, '{}')) > 50 then perform app.raise('HZ422', 'Check at most 50 reports at a time.'); end if;
  for s in select * from public.report_snapshots where id = any (p_ids) loop
    continue when not app.can_view_user_work(s.workspace_id, s.subject_user_id);
    v_now := app.report_fingerprint(app.report_source(s.workspace_id, s.kind, s.subject_user_id, s.period_start, s.period_end, s.task_id, s.filters));
    v_out := v_out || jsonb_build_object('id', s.id, 'changed', v_now <> s.source_fingerprint, 'current_fingerprint', v_now);
  end loop;
  return v_out;
end $$;

-- ═════════════ Automatic weekly and monthly reports (Decision 90, test A32) ═════════════
-- After a week closes: its weekly report; and when it is the last week whose Friday is in a month, that month's report.
-- A report failure must never block the payroll close, so errors are downgraded to warnings.
create or replace function app.auto_reports_on_close() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_month date;
begin
  begin
    v_id := app.create_report_snapshot(new.workspace_id, 'weekly', new.user_id, new.week_start, null, null, '{}'::jsonb, null, true);
    if v_id is not null then
      perform app.emit(new.workspace_id, null, new.user_id, 'report', v_id, null, 'report.generated',
        format('Weekly report ready for %s: week of %s', app.display_name(new.user_id), to_char(new.week_start, 'DD Mon YYYY')),
        null, null, '{}'::jsonb, false, '/analytics/reports');
    end if;
    if date_trunc('month', new.week_start + 6) <> date_trunc('month', new.week_start + 13) then
      v_month := date_trunc('month', new.week_start + 6)::date;
      v_id := app.create_report_snapshot(new.workspace_id, 'monthly', new.user_id, v_month, null, null, '{}'::jsonb, null, true);
      if v_id is not null then
        perform app.emit(new.workspace_id, null, new.user_id, 'report', v_id, null, 'report.generated',
          format('Monthly report ready for %s: %s', app.display_name(new.user_id), to_char(v_month, 'FMMonth YYYY')),
          null, null, '{}'::jsonb, false, '/analytics/reports');
      end if;
    end if;
  exception when others then
    raise warning 'Hobzerve: automatic report for week % of % failed: %', new.week_start, new.user_id, sqlerrm;
  end;
  return new;
end $$;

create trigger week_closures_auto_reports after insert on public.week_closures
  for each row execute function app.auto_reports_on_close();

revoke all on all functions in schema public from public, anon;
grant execute on function
  public.create_report(uuid, text, uuid, date, uuid, jsonb),
  public.get_report(uuid),
  public.report_changes(uuid[])
to authenticated;
