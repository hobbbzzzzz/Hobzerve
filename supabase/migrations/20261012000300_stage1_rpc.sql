-- Hobzerve Stage 1 — transactional RPCs.
-- Every function: SECURITY DEFINER, empty search_path, explicit authorization, audit + in-app notification
-- in the same transaction. Error codes: HZ401 auth, HZ403 forbidden, HZ404 not found, HZ409 version
-- conflict, HZ422 validation, HZ423 locked by a business rule.

-- ═════════════ Internal helpers ═════════════
create or replace function app.require_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then perform app.raise('HZ401', 'Sign in required.'); end if;
  return v;
end $$;

create or replace function app.display_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select display_name from public.profiles where id = p_user), 'System')
$$;

create or replace function app.require_manager(p_workspace uuid, p_uid uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.member_role(p_workspace, p_uid) is distinct from 'manager' then
    perform app.raise('HZ403', 'Only the manager can do this.');
  end if;
end $$;

create or replace function app.lock_task(p_task uuid) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or not app.can_view_user_work(t.workspace_id, t.assignee_id) then
    perform app.raise('HZ404', 'Task not found.');
  end if;
  return t;
end $$;

create or replace function app.check_version(p_actual integer, p_expected integer) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_expected is null then
    perform app.raise('HZ422', 'expected_version is required.');
  end if;
  if p_actual <> p_expected then
    perform app.raise('HZ409', 'This item changed since you opened it. Refresh and try again.');
  end if;
end $$;

create or replace function app.require_assignee(p_task public.tasks, p_uid uuid) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_task.assignee_id <> p_uid then
    perform app.raise('HZ403', 'Only the assigned employee can do this. Use "Request change" instead.');
  end if;
end $$;

-- Archived tasks and subtasks of a completed parent cannot be worked on (Decision 105).
create or replace function app.assert_workable(p_task public.tasks) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_parent_status public.task_status;
begin
  if p_task.archived_at is not null then
    perform app.raise('HZ422', 'This task is archived. Restore it first.');
  end if;
  if p_task.parent_task_id is not null then
    select status into v_parent_status from public.tasks where id = p_task.parent_task_id;
    if v_parent_status = 'completed' then
      perform app.raise('HZ423', 'The parent task is completed. Reopen the parent before continuing work on this subtask.');
    end if;
  end if;
end $$;

create or replace function app.is_open_status(p_status public.task_status) returns boolean
language sql immutable set search_path = '' as $$
  select p_status in ('not_started', 'in_progress', 'on_hold')
$$;

create or replace function app.next_rank(p_workspace uuid, p_assignee uuid, p_queue public.task_queue)
returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(max(priority_rank), 0) + 1 from public.tasks
  where workspace_id = p_workspace and assignee_id = p_assignee and queue = p_queue
    and parent_task_id is null and archived_at is null
    and status in ('not_started', 'in_progress', 'on_hold')
$$;

-- Ranks are 1..N over open, unarchived top-level tasks of one queue; everything else has no rank.
-- Rank changes deliberately do not bump record_version: rank is manager-owned and must not
-- create version conflicts for the employee's operational edits.
create or replace function app.renumber_queue(p_workspace uuid, p_assignee uuid, p_queue public.task_queue)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.tasks t set priority_rank = null
  where t.workspace_id = p_workspace and t.assignee_id = p_assignee and t.queue = p_queue
    and t.parent_task_id is null and t.priority_rank is not null
    and (t.archived_at is not null or t.status not in ('not_started', 'in_progress', 'on_hold'));

  with ranked as (
    select id, row_number() over (order by priority_rank nulls last, created_at, id)::integer as rn
    from public.tasks
    where workspace_id = p_workspace and assignee_id = p_assignee and queue = p_queue
      and parent_task_id is null and archived_at is null
      and status in ('not_started', 'in_progress', 'on_hold')
  )
  update public.tasks t set priority_rank = r.rn
  from ranked r
  where t.id = r.id and t.priority_rank is distinct from r.rn;
end $$;

create or replace function app.deliverable_json(d public.deliverables) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'origin', d.origin, 'status', d.status, 'title', d.title,
    'description', d.description, 'scope_cycle_id', d.scope_cycle_id, 'delivered_at', d.delivered_at,
    'archived_at', d.archived_at, 'version', d.version)
$$;

create or replace function app.task_link(p_task uuid) returns text
language sql immutable set search_path = '' as $$
  select '/tasks/' || p_task::text
$$;

-- ═════════════ Tasks ═════════════
create or replace function public.create_task(
  p_workspace uuid,
  p_title text,
  p_description text default '',
  p_category uuid default null,
  p_work_type public.task_work_type default 'one_off',
  p_complexity public.task_complexity default 'moderate',
  p_estimated_minutes integer default null,
  p_estimated_date date default null,
  p_due_at timestamptz default null,
  p_queue public.task_queue default 'planned',
  p_priority_level public.priority_level default null,
  p_assignee uuid default null,
  p_parent uuid default null,
  p_labels text[] default '{}',
  p_expected_deliverables text[] default '{}',
  p_request_id text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_role public.member_role := app.member_role(p_workspace, v_uid);
  v_assignee uuid;
  v_parent public.tasks;
  v_task_id uuid;
  v_cycle_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_existing uuid;
  v_item text;
  v_deliverable public.deliverables;
  v_queue public.task_queue := p_queue;
begin
  if v_role is null then perform app.raise('HZ403', 'You are not a member of this workspace.'); end if;

  if p_request_id is not null then
    select entity_id into v_existing from public.audit_events
    where request_id = p_request_id and actor_id = v_uid and event_type = 'task.created';
    if v_existing is not null then return v_existing; end if;
  end if;

  if char_length(v_title) = 0 then perform app.raise('HZ422', 'Title is required.'); end if;

  if v_role = 'employee' then
    if p_assignee is not null and p_assignee <> v_uid then
      perform app.raise('HZ403', 'Employees can only create tasks for themselves.');
    end if;
    if p_priority_level is not null and p_priority_level <> 'medium' then
      perform app.raise('HZ403', 'Only the manager sets priority. You can request a priority change after creating the task.');
    end if;
    v_assignee := v_uid;
  else
    if p_assignee is null then perform app.raise('HZ422', 'Choose who the task is assigned to.'); end if;
    if app.member_role(p_workspace, p_assignee) is distinct from 'employee' then
      perform app.raise('HZ422', 'The assignee must be an active employee of this workspace.');
    end if;
    v_assignee := p_assignee;
  end if;

  if p_category is not null and not exists (
    select 1 from public.categories c where c.id = p_category and c.workspace_id = p_workspace and c.archived_at is null
  ) then
    perform app.raise('HZ422', 'Unknown or archived category.');
  end if;

  if p_parent is not null then
    select * into v_parent from public.tasks where id = p_parent for update;
    if not found or v_parent.workspace_id <> p_workspace then perform app.raise('HZ404', 'Parent task not found.'); end if;
    if v_parent.parent_task_id is not null then perform app.raise('HZ422', 'Subtasks cannot have their own subtasks.'); end if;
    if v_parent.assignee_id <> v_assignee then perform app.raise('HZ422', 'A subtask must have the same assignee as its parent.'); end if;
    if v_parent.archived_at is not null then perform app.raise('HZ422', 'The parent task is archived.'); end if;
    if v_parent.status = 'completed' then
      perform app.raise('HZ423', 'The parent task is completed. The employee must reopen it before subtasks can be added.');
    end if;
    if v_parent.status = 'cancelled' then perform app.raise('HZ423', 'The parent task is cancelled. Reactivate it first.'); end if;
    v_queue := v_parent.queue;
  end if;

  insert into public.tasks (workspace_id, assignee_id, creator_id, parent_task_id, category_id, title, description,
                            labels, work_type, complexity, estimated_minutes, estimated_date, queue, priority_level,
                            priority_rank, origin, original_due_at, current_due_at)
  values (p_workspace, v_assignee, v_uid, p_parent, p_category, v_title, coalesce(p_description, ''),
          coalesce(p_labels, '{}'), p_work_type, p_complexity, p_estimated_minutes, p_estimated_date, v_queue,
          coalesce(p_priority_level, 'medium'),
          case when p_parent is null then app.next_rank(p_workspace, v_assignee, v_queue) end,
          case when v_role = 'employee' then 'employee_initiative'::public.task_origin else 'assigned'::public.task_origin end,
          p_due_at, p_due_at)
  returning id into v_task_id;

  insert into public.scope_cycles (workspace_id, task_id, sequence, type, opened_by)
  values (p_workspace, v_task_id, 1, 'original', v_uid)
  returning id into v_cycle_id;
  update public.tasks set current_scope_cycle_id = v_cycle_id where id = v_task_id;

  foreach v_item in array coalesce(p_expected_deliverables, '{}') loop
    continue when btrim(v_item) = '';
    insert into public.deliverables (workspace_id, task_id, scope_cycle_id, kind, title, added_by)
    values (p_workspace, v_task_id, v_cycle_id, 'expected', btrim(v_item), v_uid)
    returning * into v_deliverable;
    insert into public.deliverable_revisions (workspace_id, deliverable_id, version, snapshot, changed_by)
    values (p_workspace, v_deliverable.id, 1, app.deliverable_json(v_deliverable), v_uid);
  end loop;

  perform app.emit(p_workspace, v_uid, v_assignee, 'task', v_task_id, v_task_id, 'task.created',
    case when v_role = 'manager'
      then format('%s assigned a new %s to %s: "%s"', app.display_name(v_uid), case when p_parent is null then 'task' else 'subtask' end,
                  app.display_name(v_assignee), v_title)
      else format('%s created a %s: "%s"', app.display_name(v_uid), case when p_parent is null then 'task' else 'subtask' end, v_title) end,
    null, (select to_jsonb(t) from public.tasks t where t.id = v_task_id), '{}'::jsonb, false,
    app.task_link(coalesce(p_parent, v_task_id)), p_request_id);

  return v_task_id;
end $$;

create or replace function public.update_task(p_task uuid, p_expected_version integer, p_patch jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_key text;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_allowed text[] := array['title', 'description', 'category_id', 'work_type', 'complexity',
                            'estimated_minutes', 'estimated_date', 'labels'];
  n public.tasks;
begin
  perform app.check_version(t.record_version, p_expected_version);
  if t.archived_at is not null then perform app.raise('HZ422', 'This task is archived. Restore it first.'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform app.raise('HZ422', 'Nothing to update.'); end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if not v_key = any (v_allowed) then
      perform app.raise('HZ422', format('Field "%s" cannot be edited here.', v_key));
    end if;
  end loop;

  n := t;
  if p_patch ? 'title' then
    n.title := btrim(coalesce(p_patch ->> 'title', ''));
    if char_length(n.title) = 0 then perform app.raise('HZ422', 'Title is required.'); end if;
  end if;
  if p_patch ? 'description' then n.description := coalesce(p_patch ->> 'description', ''); end if;
  if p_patch ? 'category_id' then
    n.category_id := nullif(p_patch ->> 'category_id', '')::uuid;
    if n.category_id is not null and not exists (
      select 1 from public.categories c where c.id = n.category_id and c.workspace_id = t.workspace_id and c.archived_at is null
    ) then perform app.raise('HZ422', 'Unknown or archived category.'); end if;
  end if;
  if p_patch ? 'work_type' then n.work_type := (p_patch ->> 'work_type')::public.task_work_type; end if;
  if p_patch ? 'complexity' then n.complexity := (p_patch ->> 'complexity')::public.task_complexity; end if;
  if p_patch ? 'estimated_minutes' then n.estimated_minutes := nullif(p_patch ->> 'estimated_minutes', '')::integer; end if;
  if p_patch ? 'estimated_date' then n.estimated_date := nullif(p_patch ->> 'estimated_date', '')::date; end if;
  if p_patch ? 'labels' then
    n.labels := coalesce(array(select btrim(x) from jsonb_array_elements_text(p_patch -> 'labels') x where btrim(x) <> ''), '{}');
  end if;

  foreach v_key in array v_allowed loop
    if (to_jsonb(t) -> v_key) is distinct from (to_jsonb(n) -> v_key) then
      v_old := v_old || jsonb_build_object(v_key, to_jsonb(t) -> v_key);
      v_new := v_new || jsonb_build_object(v_key, to_jsonb(n) -> v_key);
    end if;
  end loop;

  if v_new = '{}'::jsonb then return t.record_version; end if;

  update public.tasks set
    title = n.title, description = n.description, category_id = n.category_id, work_type = n.work_type,
    complexity = n.complexity, estimated_minutes = n.estimated_minutes, estimated_date = n.estimated_date,
    labels = n.labels, record_version = record_version + 1
  where id = p_task;

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.updated',
    format('%s edited "%s" (%s)', app.display_name(v_uid), n.title,
           (select string_agg(replace(k, '_', ' '), ', ') from jsonb_object_keys(v_new) k)),
    v_old, v_new, '{}'::jsonb, false, app.task_link(coalesce(t.parent_task_id, t.id)));

  return t.record_version + 1;
end $$;

-- Deadline edits: both roles, mandatory reason, locked while completed (Decisions 04, 108).
create or replace function public.change_deadline(p_task uuid, p_expected_version integer, p_due_at timestamptz, p_reason text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform app.check_version(t.record_version, p_expected_version);
  if t.archived_at is not null then perform app.raise('HZ422', 'This task is archived. Restore it first.'); end if;
  if t.status = 'completed' then
    perform app.raise('HZ423', 'Deadline is locked while the task is completed. The employee must reopen it first.');
  end if;
  if char_length(v_reason) < 3 then perform app.raise('HZ422', 'A reason is required to change the deadline.'); end if;
  if p_due_at is not distinct from t.current_due_at then perform app.raise('HZ422', 'The deadline is unchanged.'); end if;

  insert into public.deadline_changes (workspace_id, task_id, from_due_at, to_due_at, reason, actor_id)
  values (t.workspace_id, t.id, t.current_due_at, p_due_at, v_reason, v_uid);

  update public.tasks set
    current_due_at = p_due_at,
    original_due_at = coalesce(original_due_at, p_due_at),
    record_version = record_version + 1
  where id = p_task;

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.deadline_changed',
    format('%s changed the deadline of "%s"', app.display_name(v_uid), t.title),
    jsonb_build_object('due_at', t.current_due_at), jsonb_build_object('due_at', p_due_at),
    jsonb_build_object('reason', v_reason, 'body', v_reason), true, app.task_link(coalesce(t.parent_task_id, t.id)));

  return t.record_version + 1;
end $$;

-- Progress: employee only, only while in progress (on hold freezes progress, Decision 06).
create or replace function public.set_progress(p_task uuid, p_expected_version integer, p_progress integer, p_note text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
begin
  perform app.require_assignee(t, v_uid);
  perform app.check_version(t.record_version, p_expected_version);
  perform app.assert_workable(t);
  if p_progress is null or p_progress < 0 or p_progress > 100 then perform app.raise('HZ422', 'Progress must be between 0 and 100.'); end if;
  if t.status = 'not_started' then perform app.raise('HZ422', 'Start the task before updating progress.'); end if;
  if t.status = 'on_hold' then perform app.raise('HZ423', 'Progress is frozen while the task is on hold. Resume it first.'); end if;
  if t.status <> 'in_progress' then perform app.raise('HZ422', 'Progress can only change while the task is in progress.'); end if;
  if p_progress = t.manual_progress then return t.record_version; end if;

  update public.tasks set manual_progress = p_progress, record_version = record_version + 1 where id = p_task;

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.progress_updated',
    format('%s updated progress on "%s" to %s%%', app.display_name(v_uid), t.title, p_progress),
    jsonb_build_object('progress', t.manual_progress), jsonb_build_object('progress', p_progress),
    jsonb_build_object('note', p_note, 'body', p_note), false, app.task_link(coalesce(t.parent_task_id, t.id)));

  return t.record_version + 1;
end $$;

-- Lifecycle actions: start, hold, resume, cancel, reactivate (employee only, Decision 07).
create or replace function public.change_task_status(p_task uuid, p_expected_version integer, p_action text, p_reason text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_to public.task_status;
  v_hold_seconds integer;
  v_label text;
begin
  perform app.require_assignee(t, v_uid);
  perform app.check_version(t.record_version, p_expected_version);
  perform app.assert_workable(t);

  case p_action
    when 'start' then
      if t.status <> 'not_started' then perform app.raise('HZ422', 'Only a not-started task can be started.'); end if;
      v_to := 'in_progress'; v_label := 'started';
    when 'hold' then
      if t.status <> 'in_progress' then perform app.raise('HZ422', 'Only an in-progress task can be put on hold.'); end if;
      if v_reason is null or char_length(v_reason) < 3 then perform app.raise('HZ422', 'A reason is required to put a task on hold.'); end if;
      v_to := 'on_hold'; v_label := 'put on hold';
    when 'resume' then
      if t.status <> 'on_hold' then perform app.raise('HZ422', 'Only an on-hold task can be resumed.'); end if;
      select extract(epoch from (now() - max(occurred_at)))::integer into v_hold_seconds
      from public.task_status_events where task_id = t.id and action = 'hold';
      v_to := 'in_progress'; v_label := 'resumed';
    when 'cancel' then
      if not app.is_open_status(t.status) then perform app.raise('HZ422', 'Only an open task can be cancelled.'); end if;
      if v_reason is null or char_length(v_reason) < 3 then perform app.raise('HZ422', 'A reason is required to cancel a task.'); end if;
      v_to := 'cancelled'; v_label := 'cancelled';
    when 'reactivate' then
      if t.status <> 'cancelled' then perform app.raise('HZ422', 'Only a cancelled task can be reactivated.'); end if;
      v_to := case when t.started_at is null then 'not_started'::public.task_status else 'in_progress'::public.task_status end;
      v_label := 'reactivated';
    else
      perform app.raise('HZ422', 'Unknown action.');
  end case;

  update public.tasks set
    status = v_to,
    started_at = case when p_action = 'start' then coalesce(started_at, now()) else started_at end,
    cancelled_at = case when p_action = 'cancel' then now() when p_action = 'reactivate' then null else cancelled_at end,
    priority_rank = case when p_action = 'reactivate' and parent_task_id is null
                         then app.next_rank(workspace_id, assignee_id, queue) else priority_rank end,
    record_version = record_version + 1
  where id = p_task;

  if t.parent_task_id is null then perform app.renumber_queue(t.workspace_id, t.assignee_id, t.queue); end if;

  insert into public.task_status_events (workspace_id, task_id, action, from_status, to_status, reason, hold_seconds, actor_id)
  values (t.workspace_id, t.id, p_action, t.status, v_to, v_reason, v_hold_seconds, v_uid);

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.status_changed',
    format('%s %s "%s"', app.display_name(v_uid), v_label, t.title),
    jsonb_build_object('status', t.status), jsonb_build_object('status', v_to),
    jsonb_build_object('action', p_action, 'reason', v_reason, 'body', v_reason, 'hold_seconds', v_hold_seconds),
    p_action in ('cancel', 'hold'), app.task_link(coalesce(t.parent_task_id, t.id)));

  return t.record_version + 1;
end $$;

-- Planned ↔ Active: employee moves freely, manager is notified (Decision 37).
create or replace function public.move_task_queue(p_task uuid, p_expected_version integer, p_queue public.task_queue)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
begin
  perform app.require_assignee(t, v_uid);
  perform app.check_version(t.record_version, p_expected_version);
  perform app.assert_workable(t);
  if t.parent_task_id is not null then perform app.raise('HZ422', 'Subtasks follow their parent''s queue.'); end if;
  if not app.is_open_status(t.status) then perform app.raise('HZ422', 'Only open tasks can move between queues.'); end if;
  if t.queue = p_queue then return t.record_version; end if;

  update public.tasks set
    queue = p_queue,
    priority_rank = app.next_rank(workspace_id, assignee_id, p_queue),
    record_version = record_version + 1
  where id = p_task;
  update public.tasks set queue = p_queue where parent_task_id = p_task;

  perform app.renumber_queue(t.workspace_id, t.assignee_id, t.queue);
  perform app.renumber_queue(t.workspace_id, t.assignee_id, p_queue);

  insert into public.task_status_events (workspace_id, task_id, action, from_queue, to_queue, actor_id)
  values (t.workspace_id, t.id, 'queue_move', t.queue, p_queue, v_uid);

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.queue_moved',
    format('%s moved "%s" to %s', app.display_name(v_uid), t.title, initcap(p_queue::text)),
    jsonb_build_object('queue', t.queue), jsonb_build_object('queue', p_queue), '{}'::jsonb, false,
    app.task_link(t.id));

  return t.record_version + 1;
end $$;

-- Manager drag-and-drop ranking, separate per queue (Decisions 10, 38, 61).
create or replace function public.reorder_queue(p_workspace uuid, p_assignee uuid, p_queue public.task_queue, p_ordered uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_current uuid[];
  v_old_order jsonb;
begin
  perform app.require_manager(p_workspace, v_uid);

  perform 1 from public.tasks
  where workspace_id = p_workspace and assignee_id = p_assignee and queue = p_queue and parent_task_id is null
  for update;

  select coalesce(array_agg(id order by priority_rank nulls last, created_at, id), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'rank', priority_rank) order by priority_rank), '[]'::jsonb)
    into v_current, v_old_order
  from public.tasks
  where workspace_id = p_workspace and assignee_id = p_assignee and queue = p_queue
    and parent_task_id is null and archived_at is null and status in ('not_started', 'in_progress', 'on_hold');

  if cardinality(coalesce(p_ordered, '{}')) <> cardinality(v_current)
     or (select count(distinct x) from unnest(p_ordered) x) <> cardinality(v_current)
     or exists (select 1 from unnest(p_ordered) x where not x = any (v_current)) then
    perform app.raise('HZ409', 'The queue changed while you were reordering. Refresh and try again.');
  end if;

  if p_ordered = v_current then return; end if;

  update public.tasks t set priority_rank = o.ord::integer
  from unnest(p_ordered) with ordinality as o(id, ord)
  where t.id = o.id;

  perform app.emit(p_workspace, v_uid, p_assignee, 'queue', null, null, 'queue.reordered',
    format('%s reordered the %s queue of %s', app.display_name(v_uid), p_queue::text, app.display_name(p_assignee)),
    jsonb_build_object('order', v_old_order),
    jsonb_build_object('order', (select jsonb_agg(jsonb_build_object('id', o.id, 'rank', o.ord)) from unnest(p_ordered) with ordinality o(id, ord))),
    jsonb_build_object('queue', p_queue), true, '/tasks?view=list&queue=' || p_queue::text);
end $$;

create or replace function public.set_priority_level(p_task uuid, p_level public.priority_level)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
begin
  perform app.require_manager(t.workspace_id, v_uid);
  if t.priority_level = p_level then return; end if;
  update public.tasks set priority_level = p_level where id = p_task;
  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.priority_changed',
    format('%s set priority of "%s" to %s', app.display_name(v_uid), t.title, initcap(p_level::text)),
    jsonb_build_object('priority_level', t.priority_level), jsonb_build_object('priority_level', p_level),
    '{}'::jsonb, true, app.task_link(coalesce(t.parent_task_id, t.id)));
end $$;

-- Dependencies warn but never block (Decision 25); cycles are rejected.
create or replace function public.add_task_dependency(p_task uuid, p_depends_on uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  d public.tasks := app.lock_task(p_depends_on);
begin
  if t.workspace_id <> d.workspace_id then perform app.raise('HZ422', 'Tasks must be in the same workspace.'); end if;
  if p_task = p_depends_on then perform app.raise('HZ422', 'A task cannot depend on itself.'); end if;
  if exists (
    with recursive chain(id) as (
      select depends_on_task_id from public.task_dependencies where task_id = p_depends_on
      union
      select dep.depends_on_task_id from public.task_dependencies dep join chain c on dep.task_id = c.id
    )
    select 1 from chain where id = p_task
  ) then
    perform app.raise('HZ422', 'That dependency would create a cycle.');
  end if;

  insert into public.task_dependencies (task_id, depends_on_task_id, workspace_id, created_by)
  values (p_task, p_depends_on, t.workspace_id, v_uid)
  on conflict do nothing;

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.dependency_added',
    format('%s marked "%s" as depending on "%s"', app.display_name(v_uid), t.title, d.title),
    null, jsonb_build_object('depends_on', p_depends_on), '{}'::jsonb, false, app.task_link(t.id));
end $$;

create or replace function public.remove_task_dependency(p_task uuid, p_depends_on uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
begin
  delete from public.task_dependencies where task_id = p_task and depends_on_task_id = p_depends_on;
  if found then
    perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.dependency_removed',
      format('%s removed a dependency from "%s"', app.display_name(v_uid), t.title),
      jsonb_build_object('depends_on', p_depends_on), null, '{}'::jsonb, false, app.task_link(t.id));
  end if;
end $$;

-- ═════════════ Deliverables ═════════════
create or replace function app.assert_scope_editable(t public.tasks) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_workable(t);
  if t.status = 'completed' then
    perform app.raise('HZ423', 'This task is completed. The employee must reopen it (revision or additional scope) before its scope changes.');
  end if;
  if t.status = 'cancelled' then perform app.raise('HZ423', 'This task is cancelled. Reactivate it first.'); end if;
end $$;

create or replace function public.add_deliverable(p_task uuid, p_kind public.deliverable_kind, p_title text, p_description text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_title text := btrim(coalesce(p_title, ''));
  d public.deliverables;
  v_origin public.deliverable_origin;
begin
  perform app.assert_scope_editable(t);
  if char_length(v_title) = 0 then perform app.raise('HZ422', 'Deliverable title is required.'); end if;
  if p_kind = 'extra' then
    v_origin := case when v_uid = t.assignee_id then 'self_initiated'::public.deliverable_origin
                     else 'manager_requested'::public.deliverable_origin end;
  end if;

  insert into public.deliverables (workspace_id, task_id, scope_cycle_id, kind, origin, title, description, added_by)
  values (t.workspace_id, t.id, t.current_scope_cycle_id, p_kind, v_origin, v_title, coalesce(p_description, ''), v_uid)
  returning * into d;
  insert into public.deliverable_revisions (workspace_id, deliverable_id, version, snapshot, changed_by)
  values (t.workspace_id, d.id, 1, app.deliverable_json(d), v_uid);

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'deliverable', d.id, t.id,
    case when p_kind = 'expected' then 'scope.changed' else 'deliverable.extra_added' end,
    case when p_kind = 'expected'
      then format('%s added expected deliverable "%s" to "%s"', app.display_name(v_uid), v_title, t.title)
      else format('%s added extra deliverable "%s" to "%s"', app.display_name(v_uid), v_title, t.title) end,
    null, app.deliverable_json(d), jsonb_build_object('kind', p_kind, 'origin', v_origin),
    p_kind = 'expected' and v_uid <> t.assignee_id, app.task_link(coalesce(t.parent_task_id, t.id)));

  return d.id;
end $$;

create or replace function app.lock_deliverable(p_deliverable uuid) returns public.deliverables
language plpgsql security definer set search_path = '' as $$
declare d public.deliverables;
begin
  select * into d from public.deliverables where id = p_deliverable for update;
  if not found or not app.can_view_task(d.task_id) then perform app.raise('HZ404', 'Deliverable not found.'); end if;
  return d;
end $$;

create or replace function public.update_deliverable(p_deliverable uuid, p_expected_version integer, p_title text, p_description text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  d public.deliverables := app.lock_deliverable(p_deliverable);
  t public.tasks := app.lock_task(d.task_id);
  n public.deliverables;
begin
  perform app.check_version(d.version, p_expected_version);
  perform app.assert_scope_editable(t);
  if char_length(btrim(coalesce(p_title, ''))) = 0 then perform app.raise('HZ422', 'Deliverable title is required.'); end if;

  update public.deliverables set title = btrim(p_title), description = coalesce(p_description, ''), version = version + 1
  where id = p_deliverable returning * into n;
  insert into public.deliverable_revisions (workspace_id, deliverable_id, version, snapshot, changed_by)
  values (d.workspace_id, d.id, n.version, app.deliverable_json(n), v_uid);

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'deliverable', d.id, t.id, 'deliverable.updated',
    format('%s edited deliverable "%s" on "%s"', app.display_name(v_uid), n.title, t.title),
    app.deliverable_json(d), app.deliverable_json(n), '{}'::jsonb, false, app.task_link(coalesce(t.parent_task_id, t.id)));
  return n.version;
end $$;

create or replace function public.set_deliverable_status(p_deliverable uuid, p_expected_version integer, p_status public.deliverable_status)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  d public.deliverables := app.lock_deliverable(p_deliverable);
  t public.tasks := app.lock_task(d.task_id);
  n public.deliverables;
begin
  perform app.require_assignee(t, v_uid);
  perform app.check_version(d.version, p_expected_version);
  perform app.assert_scope_editable(t);
  if d.archived_at is not null then perform app.raise('HZ422', 'This deliverable is archived.'); end if;
  if d.status = p_status then return d.version; end if;

  update public.deliverables set
    status = p_status,
    delivered_at = case when p_status = 'delivered' then now() else null end,
    version = version + 1
  where id = p_deliverable returning * into n;
  insert into public.deliverable_revisions (workspace_id, deliverable_id, version, snapshot, changed_by)
  values (d.workspace_id, d.id, n.version, app.deliverable_json(n), v_uid);

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'deliverable', d.id, t.id, 'deliverable.status_changed',
    format('%s marked "%s" as %s', app.display_name(v_uid), d.title, replace(p_status::text, '_', ' ')),
    jsonb_build_object('status', d.status), jsonb_build_object('status', p_status), '{}'::jsonb, false,
    app.task_link(coalesce(t.parent_task_id, t.id)));
  return n.version;
end $$;

create or replace function public.set_deliverable_archived(p_deliverable uuid, p_archived boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  d public.deliverables := app.lock_deliverable(p_deliverable);
  t public.tasks := app.lock_task(d.task_id);
  n public.deliverables;
begin
  perform app.assert_scope_editable(t);
  if (d.archived_at is not null) = p_archived then return; end if;
  update public.deliverables set archived_at = case when p_archived then now() end, version = version + 1
  where id = p_deliverable returning * into n;
  insert into public.deliverable_revisions (workspace_id, deliverable_id, version, snapshot, changed_by)
  values (d.workspace_id, d.id, n.version, app.deliverable_json(n), v_uid);
  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'deliverable', d.id, t.id,
    case when p_archived then 'deliverable.archived' else 'deliverable.restored' end,
    format('%s %s deliverable "%s"', app.display_name(v_uid), case when p_archived then 'archived' else 'restored' end, d.title),
    null, null, jsonb_build_object('reason', p_reason, 'body', p_reason), false, app.task_link(coalesce(t.parent_task_id, t.id)));
end $$;

create or replace function public.add_deliverable_evidence(p_deliverable uuid, p_url text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  d public.deliverables := app.lock_deliverable(p_deliverable);
  t public.tasks;
  v_id uuid;
begin
  select * into t from public.tasks where id = d.task_id;
  if nullif(btrim(coalesce(p_url, '')), '') is null and nullif(btrim(coalesce(p_note, '')), '') is null then
    perform app.raise('HZ422', 'Add a link or a note.');
  end if;
  if p_url is not null and btrim(p_url) <> '' and btrim(p_url) !~* '^https?://' then
    perform app.raise('HZ422', 'Links must start with http:// or https://');
  end if;
  insert into public.deliverable_evidence (workspace_id, deliverable_id, url, note, added_by)
  values (d.workspace_id, d.id, nullif(btrim(coalesce(p_url, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_id;
  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'deliverable', d.id, t.id, 'deliverable.evidence_added',
    format('%s added evidence to "%s"', app.display_name(v_uid), d.title),
    null, jsonb_build_object('url', p_url, 'note', p_note), '{}'::jsonb, false, app.task_link(coalesce(t.parent_task_id, t.id)));
  return v_id;
end $$;

-- ═════════════ Completion, revision, reopen ═════════════
-- Employee completes immediately; missing expected deliverables and open subtasks each need a reason
-- (Decisions 02, 18D, 21, 23). Returns the completion event id.
create or replace function public.complete_task(
  p_task uuid,
  p_expected_version integer,
  p_missing_reasons jsonb default '{}'::jsonb,
  p_subtask_reasons jsonb default '{}'::jsonb,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_missing jsonb := '{}'::jsonb;
  v_subtasks jsonb := '{}'::jsonb;
  v_lacking_d integer := 0;
  v_lacking_s integer := 0;
  r record;
  v_reason text;
  v_round uuid;
  v_event uuid;
  v_first boolean := t.first_completed_at is null;
begin
  perform app.require_assignee(t, v_uid);
  perform app.check_version(t.record_version, p_expected_version);
  perform app.assert_workable(t);
  if t.status = 'on_hold' then perform app.raise('HZ422', 'Resume the task before completing it.'); end if;
  if t.status not in ('not_started', 'in_progress') then perform app.raise('HZ422', 'Only an open task can be completed.'); end if;

  for r in
    select id, title from public.deliverables
    where task_id = t.id and scope_cycle_id = t.current_scope_cycle_id and kind = 'expected'
      and archived_at is null and status not in ('delivered', 'not_applicable')
  loop
    v_reason := btrim(coalesce(p_missing_reasons ->> r.id::text, ''));
    if char_length(v_reason) < 3 then
      v_lacking_d := v_lacking_d + 1;
    else
      v_missing := v_missing || jsonb_build_object(r.id::text, jsonb_build_object('title', r.title, 'reason', v_reason));
    end if;
  end loop;

  for r in
    select id, title from public.tasks
    where parent_task_id = t.id and archived_at is null and status not in ('completed', 'cancelled')
  loop
    v_reason := btrim(coalesce(p_subtask_reasons ->> r.id::text, ''));
    if char_length(v_reason) < 3 then
      v_lacking_s := v_lacking_s + 1;
    else
      v_subtasks := v_subtasks || jsonb_build_object(r.id::text, jsonb_build_object('title', r.title, 'reason', v_reason));
    end if;
  end loop;

  if v_lacking_d > 0 or v_lacking_s > 0 then
    raise exception 'Reasons are required for % undelivered expected deliverable(s) and % unfinished subtask(s).', v_lacking_d, v_lacking_s
      using errcode = 'HZ422',
            detail = jsonb_build_object('missing_deliverables', v_lacking_d, 'unfinished_subtasks', v_lacking_s)::text;
  end if;

  update public.revision_rounds set closed_at = now()
  where scope_cycle_id = t.current_scope_cycle_id and closed_at is null
  returning id into v_round;

  insert into public.task_completion_events (workspace_id, task_id, scope_cycle_id, revision_round_id, is_first_completion,
                                             actor_id, due_at_at_completion, progress_at_completion, deliverable_snapshot,
                                             missing_deliverable_reasons, unfinished_subtask_reasons, note)
  values (t.workspace_id, t.id, t.current_scope_cycle_id, v_round, v_first, v_uid, t.current_due_at, t.manual_progress,
          coalesce((select jsonb_agg(app.deliverable_json(d) order by d.added_at) from public.deliverables d where d.task_id = t.id), '[]'::jsonb),
          v_missing, v_subtasks, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_event;

  update public.tasks set
    status = 'completed',
    started_at = coalesce(started_at, now()),
    first_completed_at = coalesce(first_completed_at, now()),
    last_completed_at = now(),
    record_version = record_version + 1
  where id = t.id;

  if t.parent_task_id is null then perform app.renumber_queue(t.workspace_id, t.assignee_id, t.queue); end if;

  insert into public.task_status_events (workspace_id, task_id, action, from_status, to_status, reason, actor_id)
  values (t.workspace_id, t.id, 'complete', t.status, 'completed', nullif(btrim(coalesce(p_note, '')), ''), v_uid);

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id,
    case when v_first then 'task.completed' else 'task.recompleted' end,
    format('%s completed "%s"%s', app.display_name(v_uid), t.title,
           case when v_missing <> '{}'::jsonb or v_subtasks <> '{}'::jsonb then ' with documented gaps' else '' end),
    jsonb_build_object('status', t.status), jsonb_build_object('status', 'completed'),
    jsonb_build_object('completion_event_id', v_event, 'first', v_first,
                       'missing_deliverables', (select count(*) from jsonb_object_keys(v_missing)),
                       'unfinished_subtasks', (select count(*) from jsonb_object_keys(v_subtasks)),
                       'body', nullif(btrim(coalesce(p_note, '')), '')),
    false, app.task_link(coalesce(t.parent_task_id, t.id)));

  return v_event;
end $$;

-- Reopen is employee-controlled: a revision round in the current scope, or a new additional-scope cycle
-- (Decisions 09, 19, 22). First completion is never erased.
create or replace function public.reopen_task(p_task uuid, p_expected_version integer, p_mode text, p_reason text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_cycle public.scope_cycles;
  v_new_cycle uuid;
begin
  perform app.require_assignee(t, v_uid);
  perform app.check_version(t.record_version, p_expected_version);
  perform app.assert_workable(t);
  if t.status <> 'completed' then perform app.raise('HZ422', 'Only a completed task can be reopened.'); end if;
  if char_length(v_reason) < 3 then perform app.raise('HZ422', 'A reason is required to reopen a task.'); end if;

  select * into v_cycle from public.scope_cycles where id = t.current_scope_cycle_id;

  if p_mode = 'revision' then
    insert into public.revision_rounds (workspace_id, task_id, scope_cycle_id, sequence, reason, opened_by)
    values (t.workspace_id, t.id, v_cycle.id,
            coalesce((select max(sequence) from public.revision_rounds where scope_cycle_id = v_cycle.id), 0) + 1,
            v_reason, v_uid);
  elsif p_mode = 'additional_scope' then
    update public.scope_cycles set closed_at = now() where id = v_cycle.id;
    insert into public.scope_cycles (workspace_id, task_id, sequence, type, reason, opened_by)
    values (t.workspace_id, t.id, v_cycle.sequence + 1, 'additional', v_reason, v_uid)
    returning id into v_new_cycle;
    update public.tasks set current_scope_cycle_id = v_new_cycle where id = t.id;
  else
    perform app.raise('HZ422', 'Choose "revision" or "additional_scope".');
  end if;

  update public.tasks set
    status = 'in_progress',
    priority_rank = case when parent_task_id is null then app.next_rank(workspace_id, assignee_id, queue) end,
    record_version = record_version + 1
  where id = t.id;
  if t.parent_task_id is null then perform app.renumber_queue(t.workspace_id, t.assignee_id, t.queue); end if;

  insert into public.task_status_events (workspace_id, task_id, action, from_status, to_status, reason, actor_id)
  values (t.workspace_id, t.id, 'reopen_' || p_mode, 'completed', 'in_progress', v_reason, v_uid);

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.reopened',
    format('%s reopened "%s" for %s', app.display_name(v_uid), t.title,
           case when p_mode = 'revision' then 'a revision' else 'additional scope' end),
    jsonb_build_object('status', 'completed'), jsonb_build_object('status', 'in_progress', 'mode', p_mode),
    jsonb_build_object('reason', v_reason, 'body', v_reason), false, app.task_link(coalesce(t.parent_task_id, t.id)));

  return t.record_version + 1;
end $$;

-- Requests never change state; they notify the counterpart (Decisions 07, 22, 67, 68).
create or replace function public.request_task_action(p_task uuid, p_kind text, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_note text := btrim(coalesce(p_note, ''));
  v_is_manager boolean := app.member_role(t.workspace_id, v_uid) = 'manager';
  v_label text;
begin
  if char_length(v_note) < 3 then perform app.raise('HZ422', 'Add a short note explaining the request.'); end if;
  case p_kind
    when 'revision' then
      if not v_is_manager then perform app.raise('HZ403', 'Only the manager can request a revision.'); end if;
      if t.status <> 'completed' then perform app.raise('HZ422', 'Revisions can only be requested on completed tasks.'); end if;
      v_label := 'requested a revision of';
    when 'progress_update' then
      if not v_is_manager then perform app.raise('HZ403', 'Only the manager can request a progress update.'); end if;
      v_label := 'requested a progress update on';
    when 'status_change' then
      if not v_is_manager then perform app.raise('HZ403', 'Only the manager can request a status change.'); end if;
      v_label := 'requested a status change on';
    when 'priority_change' then
      if v_uid <> t.assignee_id then perform app.raise('HZ403', 'Only the assigned employee proposes priority changes.'); end if;
      v_label := 'proposed a priority change for';
    else
      perform app.raise('HZ422', 'Unknown request type.');
  end case;

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'request.' || p_kind,
    format('%s %s "%s"', app.display_name(v_uid), v_label, t.title),
    null, null, jsonb_build_object('note', v_note, 'body', v_note), p_kind = 'revision',
    app.task_link(coalesce(t.parent_task_id, t.id)));
end $$;

-- Soft delete and restore, both roles, audited (Decision 70).
create or replace function public.set_task_archived(p_task uuid, p_expected_version integer, p_archived boolean, p_reason text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
begin
  perform app.check_version(t.record_version, p_expected_version);
  if (t.archived_at is not null) = p_archived then return t.record_version; end if;

  update public.tasks set
    archived_at = case when p_archived then now() end,
    priority_rank = case when not p_archived and parent_task_id is null and status in ('not_started', 'in_progress', 'on_hold')
                         then app.next_rank(workspace_id, assignee_id, queue) else priority_rank end,
    record_version = record_version + 1
  where id = p_task;
  if t.parent_task_id is null then perform app.renumber_queue(t.workspace_id, t.assignee_id, t.queue); end if;

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id,
    case when p_archived then 'task.archived' else 'task.restored' end,
    format('%s %s "%s"', app.display_name(v_uid), case when p_archived then 'archived' else 'restored' end, t.title),
    null, null, jsonb_build_object('reason', p_reason, 'body', p_reason), false, app.task_link(coalesce(t.parent_task_id, t.id)));
  return t.record_version + 1;
end $$;

-- ═════════════ Categories (manager, Decisions 12, 71) ═════════════
create or replace function public.create_category(p_workspace uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_id uuid;
begin
  perform app.require_manager(p_workspace, v_uid);
  if char_length(btrim(coalesce(p_name, ''))) = 0 then perform app.raise('HZ422', 'Category name is required.'); end if;
  if exists (select 1 from public.categories where workspace_id = p_workspace and lower(name) = lower(btrim(p_name)) and archived_at is null) then
    perform app.raise('HZ422', 'A category with that name already exists.');
  end if;
  insert into public.categories (workspace_id, name, sort_order)
  values (p_workspace, btrim(p_name), coalesce((select max(sort_order) from public.categories where workspace_id = p_workspace), 0) + 1)
  returning id into v_id;
  perform app.emit(p_workspace, v_uid, null, 'category', v_id, null, 'category.created',
    format('%s created category "%s"', app.display_name(v_uid), btrim(p_name)), null, null, '{}'::jsonb, false, '/settings', null, '{}');
  return v_id;
end $$;

create or replace function public.update_category(p_category uuid, p_name text default null, p_archived boolean default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  c public.categories;
begin
  select * into c from public.categories where id = p_category for update;
  if not found then perform app.raise('HZ404', 'Category not found.'); end if;
  perform app.require_manager(c.workspace_id, v_uid);
  if p_name is not null and char_length(btrim(p_name)) = 0 then perform app.raise('HZ422', 'Category name is required.'); end if;
  update public.categories set
    name = coalesce(btrim(p_name), name),
    archived_at = case when p_archived is null then archived_at when p_archived then coalesce(archived_at, now()) else null end
  where id = p_category;
  perform app.emit(c.workspace_id, v_uid, null, 'category', c.id, null, 'category.updated',
    format('%s updated category "%s"', app.display_name(v_uid), coalesce(btrim(p_name), c.name)),
    to_jsonb(c), (select to_jsonb(x) from public.categories x where x.id = c.id), '{}'::jsonb, false, '/settings', null, '{}');
end $$;

-- ═════════════ Recurring tasks (Decision 100) ═════════════
create or replace function public.save_recurrence_template(
  p_workspace uuid,
  p_id uuid default null,
  p_title text default null,
  p_description text default '',
  p_assignee uuid default null,
  p_category uuid default null,
  p_complexity public.task_complexity default 'simple',
  p_estimated_minutes integer default null,
  p_priority_level public.priority_level default 'medium',
  p_frequency public.recurrence_frequency default 'daily',
  p_days_of_week smallint[] default '{0,1,2,3,4}',
  p_expected_deliverables text[] default '{}',
  p_due_local_time time default null,
  p_starts_on date default null,
  p_ends_on date default null,
  p_enabled boolean default true
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_role public.member_role := app.member_role(p_workspace, v_uid);
  v_assignee uuid;
  v_id uuid;
  v_existing public.recurrence_templates;
begin
  if v_role is null then perform app.raise('HZ403', 'You are not a member of this workspace.'); end if;
  v_assignee := case when v_role = 'employee' then v_uid else p_assignee end;
  if v_role = 'employee' and p_assignee is not null and p_assignee <> v_uid then
    perform app.raise('HZ403', 'Employees can only create recurring tasks for themselves.');
  end if;
  if v_role = 'employee' and p_priority_level <> 'medium' then
    perform app.raise('HZ403', 'Only the manager sets priority.');
  end if;
  if app.member_role(p_workspace, v_assignee) is distinct from 'employee' then
    perform app.raise('HZ422', 'The assignee must be an active employee of this workspace.');
  end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then perform app.raise('HZ422', 'Title is required.'); end if;

  if p_id is null then
    insert into public.recurrence_templates (workspace_id, assignee_id, created_by, title, description, category_id, complexity,
      estimated_minutes, priority_level, frequency, days_of_week, expected_deliverables, due_local_time, starts_on, ends_on, enabled)
    values (p_workspace, v_assignee, v_uid, btrim(p_title), coalesce(p_description, ''), p_category, p_complexity,
      p_estimated_minutes, p_priority_level, p_frequency, p_days_of_week, coalesce(p_expected_deliverables, '{}'), p_due_local_time,
      coalesce(p_starts_on, (now() at time zone (select timezone from public.workspaces where id = p_workspace))::date),
      p_ends_on, p_enabled)
    returning id into v_id;
  else
    select * into v_existing from public.recurrence_templates where id = p_id and workspace_id = p_workspace for update;
    if not found or not app.can_view_user_work(p_workspace, v_existing.assignee_id) then perform app.raise('HZ404', 'Recurring task not found.'); end if;
    update public.recurrence_templates set
      title = btrim(p_title), description = coalesce(p_description, ''), assignee_id = v_assignee, category_id = p_category,
      complexity = p_complexity, estimated_minutes = p_estimated_minutes, priority_level = p_priority_level,
      frequency = p_frequency, days_of_week = p_days_of_week, expected_deliverables = coalesce(p_expected_deliverables, '{}'),
      due_local_time = p_due_local_time, starts_on = coalesce(p_starts_on, starts_on), ends_on = p_ends_on, enabled = p_enabled
    where id = p_id;
    v_id := p_id;
  end if;

  perform app.emit(p_workspace, v_uid, v_assignee, 'recurrence_template', v_id, null,
    case when p_id is null then 'recurrence.created' else 'recurrence.updated' end,
    format('%s %s recurring task "%s"', app.display_name(v_uid), case when p_id is null then 'created' else 'updated' end, btrim(p_title)),
    case when p_id is null then null else to_jsonb(v_existing) end,
    (select to_jsonb(r) from public.recurrence_templates r where r.id = v_id), '{}'::jsonb, false, '/settings');
  return v_id;
end $$;

create or replace function public.archive_recurrence_template(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  r public.recurrence_templates;
begin
  select * into r from public.recurrence_templates where id = p_id for update;
  if not found or not app.can_view_user_work(r.workspace_id, r.assignee_id) then perform app.raise('HZ404', 'Recurring task not found.'); end if;
  update public.recurrence_templates set archived_at = now(), enabled = false where id = p_id;
  perform app.emit(r.workspace_id, v_uid, r.assignee_id, 'recurrence_template', r.id, null, 'recurrence.archived',
    format('%s archived recurring task "%s"', app.display_name(v_uid), r.title), null, null, '{}'::jsonb, false, '/settings');
end $$;

-- Generates instances for one local date. Idempotent per template + date (Decision 100, test A14).
-- Instances land in the Planned queue (PROPOSED default) and do not notify anyone.
create or replace function app.generate_recurring_instances(p_workspace uuid, p_on date, p_assignee uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
  r public.recurrence_templates;
  v_task uuid;
  v_cycle uuid;
  v_count integer := 0;
  v_due timestamptz;
  v_item text;
  v_queue public.task_queue;
  v_creator_role public.member_role;
begin
  select * into w from public.workspaces where id = p_workspace;
  v_queue := coalesce(w.settings ->> 'recurring_default_queue', 'planned')::public.task_queue;

  for r in
    select * from public.recurrence_templates
    where workspace_id = p_workspace and enabled and archived_at is null
      and (p_assignee is null or assignee_id = p_assignee)
      and starts_on <= p_on and (ends_on is null or ends_on >= p_on)
      and extract(dow from p_on)::smallint = any (days_of_week)
      and app.member_role(p_workspace, assignee_id) = 'employee'
  loop
    v_due := case when r.due_local_time is not null then ((p_on + r.due_local_time)::timestamp at time zone w.timezone) end;
    v_creator_role := app.member_role(p_workspace, r.created_by);

    insert into public.tasks (workspace_id, assignee_id, creator_id, recurrence_template_id, occurrence_date, category_id, title,
                              description, work_type, complexity, estimated_minutes, queue, priority_level, priority_rank,
                              origin, original_due_at, current_due_at)
    values (p_workspace, r.assignee_id, r.created_by, r.id, p_on, r.category_id, r.title, r.description, 'routine',
            r.complexity, r.estimated_minutes, v_queue, r.priority_level, app.next_rank(p_workspace, r.assignee_id, v_queue),
            case when r.created_by = r.assignee_id or v_creator_role = 'employee'
                 then 'employee_initiative'::public.task_origin else 'assigned'::public.task_origin end,
            v_due, v_due)
    on conflict (recurrence_template_id, occurrence_date) where recurrence_template_id is not null do nothing
    returning id into v_task;

    continue when v_task is null;

    insert into public.scope_cycles (workspace_id, task_id, sequence, type, opened_by)
    values (p_workspace, v_task, 1, 'original', r.created_by) returning id into v_cycle;
    update public.tasks set current_scope_cycle_id = v_cycle where id = v_task;

    foreach v_item in array r.expected_deliverables loop
      continue when btrim(v_item) = '';
      insert into public.deliverables (workspace_id, task_id, scope_cycle_id, kind, title, added_by)
      values (p_workspace, v_task, v_cycle, 'expected', btrim(v_item), r.created_by);
    end loop;

    perform app.emit(p_workspace, null, r.assignee_id, 'task', v_task, v_task, 'task.generated',
      format('Recurring task "%s" generated for %s', r.title, to_char(p_on, 'Dy DD Mon')),
      null, null, jsonb_build_object('template_id', r.id, 'occurrence_date', p_on), false,
      app.task_link(v_task), null, '{}');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Called by the app on load (and by pg_cron when available): today's instances for the caller's scope.
create or replace function public.generate_my_recurring_instances(p_workspace uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_role public.member_role := app.member_role(p_workspace, v_uid);
  v_today date;
begin
  if v_role is null then perform app.raise('HZ403', 'You are not a member of this workspace.'); end if;
  select (now() at time zone timezone)::date into v_today from public.workspaces where id = p_workspace;
  return app.generate_recurring_instances(p_workspace, v_today, case when v_role = 'employee' then v_uid end);
end $$;

create or replace function app.generate_all_recurring_instances() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  w record;
  v_total integer := 0;
begin
  for w in select id, timezone from public.workspaces loop
    v_total := v_total + app.generate_recurring_instances(w.id, (now() at time zone w.timezone)::date);
  end loop;
  return v_total;
end $$;

-- ═════════════ Notifications ═════════════
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_count integer;
begin
  update public.notifications set read_at = now()
  where recipient_id = v_uid and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.set_notification_mutes(p_event_types text[])
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid();
begin
  update public.profiles
  set preferences = jsonb_set(preferences, '{muted_event_types}', to_jsonb(coalesce(p_event_types, '{}')))
  where id = v_uid;
end $$;

-- ═════════════ Grants ═════════════
revoke all on all functions in schema public from public, anon;
grant execute on function
  public.create_task(uuid, text, text, uuid, public.task_work_type, public.task_complexity, integer, date, timestamptz,
                     public.task_queue, public.priority_level, uuid, uuid, text[], text[], text),
  public.update_task(uuid, integer, jsonb),
  public.change_deadline(uuid, integer, timestamptz, text),
  public.set_progress(uuid, integer, integer, text),
  public.change_task_status(uuid, integer, text, text),
  public.move_task_queue(uuid, integer, public.task_queue),
  public.reorder_queue(uuid, uuid, public.task_queue, uuid[]),
  public.set_priority_level(uuid, public.priority_level),
  public.add_task_dependency(uuid, uuid),
  public.remove_task_dependency(uuid, uuid),
  public.add_deliverable(uuid, public.deliverable_kind, text, text),
  public.update_deliverable(uuid, integer, text, text),
  public.set_deliverable_status(uuid, integer, public.deliverable_status),
  public.set_deliverable_archived(uuid, boolean, text),
  public.add_deliverable_evidence(uuid, text, text),
  public.complete_task(uuid, integer, jsonb, jsonb, text),
  public.reopen_task(uuid, integer, text, text),
  public.request_task_action(uuid, text, text),
  public.set_task_archived(uuid, integer, boolean, text),
  public.create_category(uuid, text),
  public.update_category(uuid, text, boolean),
  public.save_recurrence_template(uuid, uuid, text, text, uuid, uuid, public.task_complexity, integer, public.priority_level,
                                  public.recurrence_frequency, smallint[], text[], time, date, date, boolean),
  public.archive_recurrence_template(uuid),
  public.generate_my_recurring_instances(uuid),
  public.mark_notifications_read(uuid[]),
  public.set_notification_mutes(text[])
to authenticated;

-- Hourly recurring generation when pg_cron is available (Supabase). Idempotent, so hourly is safe and
-- avoids depending on the UTC offset of Africa/Cairo across DST.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('hobzerve-recurring-instances', '7 * * * *', 'select app.generate_all_recurring_instances()');
  end if;
end $$;
