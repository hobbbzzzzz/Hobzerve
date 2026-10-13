-- Hobzerve Stage 1 — core schema (workspaces, members, tasks, deliverables, scope, audit, notifications)
-- All timestamps are timestamptz (UTC). Day/week boundaries are computed in the workspace timezone (Africa/Cairo).
-- Clients never write tables directly: every mutation goes through the RPCs in the stage1_rpc migration.

create schema if not exists app;

-- ───────────── Enums ─────────────
create type public.member_role as enum ('employee', 'manager');
create type public.task_queue as enum ('planned', 'active');
create type public.task_status as enum ('not_started', 'in_progress', 'on_hold', 'completed', 'cancelled');
create type public.task_work_type as enum ('routine', 'one_off', 'major_project');
create type public.task_complexity as enum ('simple', 'moderate', 'complex');
create type public.task_origin as enum ('assigned', 'employee_initiative');
-- Priority level values are a PROPOSED default (not specified by the user); labels are editable in UI copy.
create type public.priority_level as enum ('low', 'medium', 'high', 'urgent');
create type public.deliverable_kind as enum ('expected', 'extra');
create type public.deliverable_origin as enum ('self_initiated', 'manager_requested');
create type public.deliverable_status as enum ('not_started', 'in_progress', 'delivered', 'not_applicable');
create type public.scope_cycle_type as enum ('original', 'additional');
create type public.recurrence_frequency as enum ('daily', 'weekly');

-- ───────────── Utility trigger ─────────────
create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────── Tenancy ─────────────
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  timezone text not null default 'Africa/Cairo',
  -- 0 = Sunday … 6 = Saturday (Postgres EXTRACT(DOW)). Week runs Saturday–Friday (Decision 33).
  week_start_dow smallint not null default 6 check (week_start_dow between 0 and 6),
  settings jsonb not null default jsonb_build_object(
    'weekly_close', jsonb_build_object('dow', 6, 'time', '23:59:59'),
    'general_activity_types', jsonb_build_array('Meeting', 'Planning', 'Research', 'Administration', 'Other'),
    'recurring_default_queue', 'planned'
  ),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  job_title text,
  locale text not null default 'en',
  -- { "muted_event_types": ["task.updated", ...] } — critical events ignore mutes (Decision 55)
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  -- Effective dates drive weekly-target proration in Stage 2 (Decision 110)
  active_from date not null default current_date,
  active_to date,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  check (active_to is null or active_to >= active_from)
);
create index on public.workspace_members (user_id);

-- ───────────── Reference data ─────────────
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index categories_unique_active_name
  on public.categories (workspace_id, lower(name)) where archived_at is null;

create table public.recurrence_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  assignee_id uuid not null references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  category_id uuid references public.categories (id),
  complexity public.task_complexity not null default 'simple',
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  priority_level public.priority_level not null default 'medium',
  frequency public.recurrence_frequency not null,
  -- 0 = Sunday … 6 = Saturday. Daily default = Sunday–Thursday working days (Decision 110).
  days_of_week smallint[] not null default '{0,1,2,3,4}',
  expected_deliverables text[] not null default '{}',
  -- Local time (workspace tz) the generated instance is due on its occurrence date; null = no deadline.
  due_local_time time,
  starts_on date not null default current_date,
  ends_on date,
  enabled boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(days_of_week) between 1 and 7),
  check (days_of_week <@ '{0,1,2,3,4,5,6}'::smallint[]),
  check (frequency = 'daily' or cardinality(days_of_week) = 1),
  check (ends_on is null or ends_on >= starts_on)
);
create trigger recurrence_templates_touch before update on public.recurrence_templates
  for each row execute function app.touch_updated_at();

-- ───────────── Tasks ─────────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  assignee_id uuid not null references public.profiles (id),
  creator_id uuid not null references public.profiles (id),
  parent_task_id uuid references public.tasks (id),
  recurrence_template_id uuid references public.recurrence_templates (id),
  occurrence_date date,
  category_id uuid references public.categories (id),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  labels text[] not null default '{}',
  work_type public.task_work_type not null default 'one_off',
  complexity public.task_complexity not null default 'moderate',
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  estimated_date date,
  queue public.task_queue not null default 'planned',
  status public.task_status not null default 'not_started',
  manual_progress smallint not null default 0 check (manual_progress between 0 and 100),
  priority_level public.priority_level not null default 'medium',
  priority_rank integer check (priority_rank is null or priority_rank > 0),
  origin public.task_origin not null,
  original_due_at timestamptz,
  current_due_at timestamptz,
  current_scope_cycle_id uuid,
  started_at timestamptz,
  first_completed_at timestamptz,
  last_completed_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,
  record_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_task_id is null or parent_task_id <> id),
  check ((recurrence_template_id is null) = (occurrence_date is null)),
  -- subtasks are never ranked; ranks exist only for open top-level tasks
  check (parent_task_id is null or priority_rank is null)
);
create unique index tasks_recurrence_occurrence_unique
  on public.tasks (recurrence_template_id, occurrence_date) where recurrence_template_id is not null;
create index tasks_workspace_assignee on public.tasks (workspace_id, assignee_id);
create index tasks_parent on public.tasks (parent_task_id);
create index tasks_queue_rank on public.tasks (assignee_id, queue, priority_rank);
create index tasks_due on public.tasks (workspace_id, current_due_at);
create trigger tasks_touch before update on public.tasks
  for each row execute function app.touch_updated_at();

create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);
create index on public.task_dependencies (depends_on_task_id);

create table public.scope_cycles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  sequence integer not null,
  type public.scope_cycle_type not null,
  reason text,
  opened_by uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (task_id, sequence)
);
alter table public.tasks
  add constraint tasks_current_scope_cycle_fk
  foreign key (current_scope_cycle_id) references public.scope_cycles (id) deferrable initially deferred;

create table public.revision_rounds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  scope_cycle_id uuid not null references public.scope_cycles (id) on delete cascade,
  sequence integer not null,
  reason text not null,
  opened_by uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (scope_cycle_id, sequence)
);

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  scope_cycle_id uuid not null references public.scope_cycles (id),
  kind public.deliverable_kind not null,
  -- extra deliverables only: who initiated it (Decision 16)
  origin public.deliverable_origin,
  status public.deliverable_status not null default 'not_started',
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  added_by uuid not null references public.profiles (id),
  added_at timestamptz not null default now(),
  delivered_at timestamptz,
  archived_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  check ((kind = 'extra') = (origin is not null))
);
create index on public.deliverables (task_id);
create trigger deliverables_touch before update on public.deliverables
  for each row execute function app.touch_updated_at();

create table public.deliverable_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  deliverable_id uuid not null references public.deliverables (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  changed_by uuid not null references public.profiles (id),
  changed_at timestamptz not null default now(),
  unique (deliverable_id, version)
);

-- Evidence is a link plus note in Stage 1; file uploads to private Storage are planned for Stage 3.
create table public.deliverable_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  deliverable_id uuid not null references public.deliverables (id) on delete cascade,
  url text check (url is null or url ~* '^https?://'),
  note text,
  added_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (url is not null or note is not null)
);

create table public.task_completion_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  scope_cycle_id uuid not null references public.scope_cycles (id),
  revision_round_id uuid references public.revision_rounds (id),
  is_first_completion boolean not null,
  completed_at timestamptz not null default now(),
  actor_id uuid not null references public.profiles (id),
  -- frozen at completion; feeds "on-time at completion" (Decision 108)
  due_at_at_completion timestamptz,
  progress_at_completion smallint not null,
  deliverable_snapshot jsonb not null,
  missing_deliverable_reasons jsonb not null default '{}'::jsonb,
  unfinished_subtask_reasons jsonb not null default '{}'::jsonb,
  note text
);
create index on public.task_completion_events (task_id, completed_at);
create unique index task_completion_first_unique
  on public.task_completion_events (task_id) where is_first_completion;

create table public.deadline_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  from_due_at timestamptz,
  to_due_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  actor_id uuid not null references public.profiles (id),
  changed_at timestamptz not null default now()
);
create index on public.deadline_changes (task_id, changed_at);

create table public.task_status_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  action text not null,
  from_status public.task_status,
  to_status public.task_status,
  from_queue public.task_queue,
  to_queue public.task_queue,
  reason text,
  -- filled on resume: duration of the hold just ended (Decision 06)
  hold_seconds integer,
  actor_id uuid not null references public.profiles (id),
  occurred_at timestamptz not null default now()
);
create index on public.task_status_events (task_id, occurred_at);

-- ───────────── Audit & notifications ─────────────
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  -- the employee whose work this event concerns; drives read access
  subject_user_id uuid references public.profiles (id),
  entity_type text not null,
  entity_id uuid,
  task_id uuid references public.tasks (id) on delete set null,
  event_type text not null,
  summary text not null,
  old_json jsonb,
  new_json jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  request_id text unique,
  occurred_at timestamptz not null default now()
);
create index on public.audit_events (workspace_id, occurred_at desc);
create index on public.audit_events (task_id, occurred_at desc);
create index on public.audit_events (subject_user_id, occurred_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  audit_event_id uuid not null references public.audit_events (id) on delete cascade,
  event_type text not null,
  group_key text not null,
  title text not null,
  body text,
  link text,
  critical boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (recipient_id, created_at desc);
create index notifications_unread on public.notifications (recipient_id) where read_at is null;

-- Created now so Stage 4 needs no schema change; nothing writes to it before Stage 4 (Decision 113).
create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  notification_id uuid references public.notifications (id) on delete set null,
  batch_id uuid,
  status text not null check (status in ('pending', 'sent', 'failed')),
  attempted_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

-- ───────────── Append-only guards ─────────────
create or replace function app.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Table % is append-only', tg_table_name using errcode = 'HZ403';
end $$;

create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function app.forbid_mutation();
create trigger deadline_changes_append_only before update or delete on public.deadline_changes
  for each row execute function app.forbid_mutation();
create trigger completion_events_append_only before update or delete on public.task_completion_events
  for each row execute function app.forbid_mutation();
create trigger deliverable_revisions_append_only before update or delete on public.deliverable_revisions
  for each row execute function app.forbid_mutation();
create trigger status_events_append_only before update or delete on public.task_status_events
  for each row execute function app.forbid_mutation();

-- Deadline lock (Decision 108): guards direct updates too, not only the RPC.
create or replace function app.guard_completed_deadline() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'completed' and new.status = 'completed'
     and new.current_due_at is distinct from old.current_due_at then
    raise exception 'Deadline is locked while the task is completed. Reopen the task first.'
      using errcode = 'HZ423';
  end if;
  return new;
end $$;
create trigger tasks_deadline_lock before update on public.tasks
  for each row execute function app.guard_completed_deadline();
