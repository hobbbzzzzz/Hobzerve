-- Hobzerve — nicknames and projects.
-- Nickname: a short name each person picks for themselves, used only in greetings and the user menu. Official records
-- (audit summaries, notifications, reports, emails) keep display_name.
-- Projects: a named, coloured grouping of tasks inside a workspace. Separate from categories (the kind of work): a task
-- can be "Tech" and belong to project "Website Revamp". No project = a general task. Subtasks follow their parent.

-- ═════════════ Nickname ═════════════
alter table public.profiles add column nickname text check (nickname is null or char_length(nickname) between 1 and 40);

create or replace function public.set_nickname(p_nickname text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid();
begin
  update public.profiles set nickname = nullif(btrim(coalesce(p_nickname, '')), '') where id = v_uid;
end $$;

-- ═════════════ Projects ═════════════
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  -- A fixed set of colour names; the app maps each to label colours that keep contrast in light and dark mode.
  color text not null default 'blue' check (color in ('blue', 'sky', 'teal', 'green', 'lime', 'amber', 'orange', 'red',
                                                      'pink', 'purple', 'violet', 'slate')),
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles (id),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index projects_unique_active_name on public.projects (workspace_id, lower(name)) where archived_at is null;

alter table public.projects enable row level security;
create policy projects_read on public.projects for select to authenticated using (app.is_member(workspace_id));
revoke all on public.projects from anon;
revoke insert, update, delete, truncate on public.projects from authenticated;
grant select on public.projects to authenticated;

alter table public.tasks add column project_id uuid references public.projects (id);
create index tasks_project on public.tasks (project_id) where project_id is not null;

create or replace function app.assert_project(p_workspace uuid, p_project uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_project is not null and not exists (
    select 1 from public.projects p where p.id = p_project and p.workspace_id = p_workspace and p.archived_at is null
  ) then
    perform app.raise('HZ422', 'Unknown or archived project.');
  end if;
end $$;

-- Both roles manage projects: they are shared labels, not a permission boundary.
create or replace function public.create_project(p_workspace uuid, p_name text, p_color text default 'blue')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if app.member_role(p_workspace, v_uid) is null then perform app.raise('HZ403', 'You are not a member of this workspace.'); end if;
  if char_length(v_name) = 0 then perform app.raise('HZ422', 'Project name is required.'); end if;
  if exists (select 1 from public.projects where workspace_id = p_workspace and lower(name) = lower(v_name) and archived_at is null) then
    perform app.raise('HZ422', 'A project with that name already exists.');
  end if;
  insert into public.projects (workspace_id, name, color, sort_order, created_by)
  values (p_workspace, v_name, coalesce(p_color, 'blue'),
          coalesce((select max(sort_order) from public.projects where workspace_id = p_workspace), 0) + 1, v_uid)
  returning id into v_id;
  perform app.emit(p_workspace, v_uid, null, 'project', v_id, null, 'project.created',
    format('%s created project "%s"', app.display_name(v_uid), v_name), null,
    (select to_jsonb(p) from public.projects p where p.id = v_id), '{}'::jsonb, false, '/tasks?view=projects', null, '{}');
  return v_id;
end $$;

create or replace function public.update_project(p_project uuid, p_name text default null, p_color text default null,
                                                 p_archived boolean default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  p public.projects;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  select * into p from public.projects where id = p_project for update;
  if not found or app.member_role(p.workspace_id, v_uid) is null then perform app.raise('HZ404', 'Project not found.'); end if;
  if p_name is not null and v_name is null then perform app.raise('HZ422', 'Project name is required.'); end if;
  if v_name is not null and exists (
    select 1 from public.projects where workspace_id = p.workspace_id and id <> p.id and lower(name) = lower(v_name) and archived_at is null
  ) then
    perform app.raise('HZ422', 'A project with that name already exists.');
  end if;
  update public.projects set
    name = coalesce(v_name, name),
    color = coalesce(p_color, color),
    archived_at = case when p_archived is null then archived_at when p_archived then coalesce(archived_at, now()) else null end
  where id = p_project;
  perform app.emit(p.workspace_id, v_uid, null, 'project', p.id, null, 'project.updated',
    format('%s updated project "%s"', app.display_name(v_uid), coalesce(v_name, p.name)),
    to_jsonb(p), (select to_jsonb(x) from public.projects x where x.id = p.id), '{}'::jsonb, false, '/tasks?view=projects', null, '{}');
end $$;

-- ═════════════ Tasks: project on create and edit ═════════════
-- create_task gains p_project. Subtasks always take their parent's project.
drop function public.create_task(uuid, text, text, uuid, public.task_work_type, public.task_complexity, integer, date,
                                 timestamptz, public.task_queue, public.priority_level, uuid, uuid, text[], text[], text);

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
  p_project uuid default null
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
    v_project := v_parent.project_id;
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

-- update_task gains project_id. Moving a parent moves its subtasks with it; a subtask can't be moved on its own.
create or replace function public.update_task(p_task uuid, p_expected_version integer, p_patch jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  t public.tasks := app.lock_task(p_task);
  v_key text;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_allowed text[] := array['title', 'description', 'category_id', 'project_id', 'work_type', 'complexity',
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
    title = n.title, description = n.description, category_id = n.category_id, project_id = n.project_id,
    work_type = n.work_type, complexity = n.complexity, estimated_minutes = n.estimated_minutes,
    estimated_date = n.estimated_date, labels = n.labels, record_version = record_version + 1
  where id = p_task;

  if n.project_id is distinct from t.project_id then
    update public.tasks set project_id = n.project_id, record_version = record_version + 1
    where parent_task_id = p_task and project_id is distinct from n.project_id;
  end if;

  perform app.emit(t.workspace_id, v_uid, t.assignee_id, 'task', t.id, t.id, 'task.updated',
    format('%s edited "%s" (%s)', app.display_name(v_uid), n.title,
           (select string_agg(replace(replace(k, '_id', ''), '_', ' '), ', ') from jsonb_object_keys(v_new) k)),
    v_old, v_new, '{}'::jsonb, false, app.task_link(coalesce(t.parent_task_id, t.id)));

  return t.record_version + 1;
end $$;

-- Analytics filters can narrow to one project ("none" = general tasks).
create or replace function app.task_matches(t public.tasks, f jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select (f ->> 'category_id' is null or t.category_id::text = f ->> 'category_id')
     and (f ->> 'work_type' is null or t.work_type::text = f ->> 'work_type')
     and (f ->> 'priority' is null or t.priority_level::text = f ->> 'priority')
     and (f ->> 'origin' is null or t.origin::text = f ->> 'origin')
     and (f ->> 'status' is null or t.status::text = f ->> 'status')
     and (f ->> 'project_id' is null or coalesce(t.project_id::text, 'none') = f ->> 'project_id')
$$;

-- ═════════════ Grants ═════════════
revoke all on all functions in schema public from public, anon;
revoke all on function app.assert_project(uuid, uuid) from public, anon, authenticated;
grant execute on function
  public.set_nickname(text),
  public.create_project(uuid, text, text),
  public.update_project(uuid, text, text, boolean),
  public.create_task(uuid, text, text, uuid, public.task_work_type, public.task_complexity, integer, date, timestamptz,
                     public.task_queue, public.priority_level, uuid, uuid, text[], text[], text, uuid),
  public.update_task(uuid, integer, jsonb)
to authenticated;
-- The anon-callable email dispatcher RPCs keep their grant (the revoke above covers every public function).
grant execute on function public.email_claim(text, integer), public.email_report(text, jsonb) to anon, authenticated;
