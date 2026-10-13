-- Hobzerve — the employee chooses whether a task is their own initiative or a manager request.
-- Before this, every task the employee created counted as initiative, so work the manager asked for (in person, by chat)
-- inflated the "own initiative" figure. Analytics needs no change: it already counts origin = 'employee_initiative'.

-- create_task gains p_origin. The employee says whether a task is their own initiative or something the manager asked
-- for (default: initiative, as before). Tasks the manager creates are always manager requests. Subtasks take their
-- parent's origin.
drop function public.create_task(uuid, text, text, uuid, public.task_work_type, public.task_complexity, integer, date,
                                 timestamptz, public.task_queue, public.priority_level, uuid, uuid, text[], text[], text, uuid);

create function public.create_task(
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
  p_request_id text default null,
  p_project uuid default null,
  p_origin public.task_origin default null
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
  v_project uuid := p_project;
  v_origin public.task_origin;
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
    v_origin := coalesce(p_origin, 'employee_initiative');
  else
    if p_origin = 'employee_initiative' then
      perform app.raise('HZ422', 'Tasks you create are manager requests. Only the employee can mark a task as their own initiative.');
    end if;
    v_origin := 'assigned';
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
    v_project := v_parent.project_id;
    v_origin := v_parent.origin;
  else
    perform app.assert_project(p_workspace, v_project);
  end if;

  insert into public.tasks (workspace_id, assignee_id, creator_id, parent_task_id, category_id, project_id, title, description,
                            labels, work_type, complexity, estimated_minutes, estimated_date, queue, priority_level,
                            priority_rank, origin, original_due_at, current_due_at)
  values (p_workspace, v_assignee, v_uid, p_parent, p_category, v_project, v_title, coalesce(p_description, ''),
          coalesce(p_labels, '{}'), p_work_type, p_complexity, p_estimated_minutes, p_estimated_date, v_queue,
          coalesce(p_priority_level, 'medium'),
          case when p_parent is null then app.next_rank(p_workspace, v_assignee, v_queue) end,
          v_origin, p_due_at, p_due_at)
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
      when v_origin = 'assigned'
      then format('%s logged a %s the manager requested: "%s"', app.display_name(v_uid), case when p_parent is null then 'task' else 'subtask' end, v_title)
      else format('%s created a %s: "%s"', app.display_name(v_uid), case when p_parent is null then 'task' else 'subtask' end, v_title) end,
    null, (select to_jsonb(t) from public.tasks t where t.id = v_task_id), '{}'::jsonb, false,
    app.task_link(coalesce(p_parent, v_task_id)), p_request_id);

  return v_task_id;
end $$;

-- update_task gains origin, for tasks the employee created themselves (a mislabelled initiative / manager request can be
-- corrected by either person; every change is in the history). Tasks the manager created stay manager requests.
-- Subtasks follow their parent's origin, like project.
create or replace function public.update_task(p_task uuid, p_expected_version integer, p_patch jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_key text;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_allowed text[] := array['title', 'description', 'category_id', 'project_id', 'origin', 'work_type', 'complexity',
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
  if p_patch ? 'project_id' then
    n.project_id := nullif(p_patch ->> 'project_id', '')::uuid;
    if n.project_id is distinct from t.project_id then
      if t.parent_task_id is not null then
        perform app.raise('HZ422', 'A subtask belongs to its parent''s project. Change the project on the parent task.');
      end if;
      perform app.assert_project(t.workspace_id, n.project_id);
    end if;
  end if;
  if p_patch ? 'origin' then
    n.origin := (p_patch ->> 'origin')::public.task_origin;
    if n.origin is distinct from t.origin then
      if t.parent_task_id is not null then
        perform app.raise('HZ422', 'A subtask follows its parent task. Change it on the parent.');
      end if;
      if t.creator_id <> t.assignee_id then
        perform app.raise('HZ422', 'The manager created this task, so it stays a manager request.');
      end if;
    end if;
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
    title = n.title, description = n.description, category_id = n.category_id, project_id = n.project_id, origin = n.origin,
    work_type = n.work_type, complexity = n.complexity, estimated_minutes = n.estimated_minutes,
    estimated_date = n.estimated_date, labels = n.labels, record_version = record_version + 1
  where id = p_task;

  if n.project_id is distinct from t.project_id or n.origin is distinct from t.origin then
    update public.tasks set project_id = n.project_id, origin = n.origin, record_version = record_version + 1
    where parent_task_id = p_task and (project_id is distinct from n.project_id or origin is distinct from n.origin);
  end if;

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.updated',
    format('%s edited "%s" (%s)', app.display_name(v_uid), n.title,
           (select string_agg(replace(replace(k, '_id', ''), '_', ' '), ', ') from jsonb_object_keys(v_new) k)),
    v_old, v_new, '{}'::jsonb, false, app.task_link(coalesce(t.parent_task_id, t.id)));

  return t.record_version + 1;
end $$;

-- ═════════════ Grants ═════════════
revoke all on all functions in schema public from public, anon;
grant execute on function
  public.create_task(uuid, text, text, uuid, public.task_work_type, public.task_complexity, integer, date, timestamptz,
                     public.task_queue, public.priority_level, uuid, uuid, text[], text[], text, uuid, public.task_origin),
  public.update_task(uuid, integer, jsonb)
to authenticated;
grant execute on function public.email_claim(text, integer), public.email_report(text, jsonb) to anon, authenticated;
