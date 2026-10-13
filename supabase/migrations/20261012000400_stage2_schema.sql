-- Hobzerve Stage 2 — attendance, live activity, task time, weekly target, weekly close and payroll adjustments.
-- Payable hours come only from closed attendance (Decision 34A); closed weeks never change (Decision 109).

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create type public.activity_kind as enum ('task', 'general', 'unassigned');
create type public.time_entry_source as enum ('timer', 'manual');

-- ───────────── Weekly target (Decisions 34, 110) ─────────────
-- A row applies to every week whose Saturday is on/after effective_from, until a later row.
create table public.weekly_target_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  effective_from date not null,
  base_target_minutes integer not null default 1200 check (base_target_minutes > 0),
  -- 0 = Sunday … 6 = Saturday. Standard working days Sunday–Thursday (Decision 110).
  working_days smallint[] not null default '{0,1,2,3,4}',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (workspace_id, effective_from),
  check (cardinality(working_days) between 1 and 7),
  check (working_days <@ '{0,1,2,3,4,5,6}'::smallint[])
);

insert into public.weekly_target_settings (workspace_id, effective_from)
select id, date '2000-01-01' from public.workspaces;

create or replace function app.default_target_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.weekly_target_settings (workspace_id, effective_from) values (new.id, date '2000-01-01')
  on conflict do nothing;
  return new;
end $$;
create trigger workspaces_default_target after insert on public.workspaces
  for each row execute function app.default_target_settings();

-- ───────────── Attendance (Decisions 26–28, 39, 81) ─────────────
create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  started_at timestamptz not null,
  ended_at timestamptz,
  origin text not null check (origin in ('clock', 'manual')),
  summary text,
  version integer not null default 1,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at),
  -- No two live (non-voided) sessions of one person may overlap.
  constraint attendance_no_overlap exclude using gist (
    user_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') with &&
  ) where (voided_at is null)
);
-- At most one open session per person, across devices (Decision 81, test A08).
create unique index attendance_one_open on public.attendance_sessions (user_id) where ended_at is null and voided_at is null;
create index attendance_by_user_time on public.attendance_sessions (workspace_id, user_id, started_at);
create trigger attendance_touch before update on public.attendance_sessions
  for each row execute function app.touch_updated_at();

-- ───────────── Live activity (Decisions 73–80) ─────────────
-- Segments tile their session exactly: switching closes one and opens the next at the same instant.
create table public.live_activity_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  attendance_session_id uuid not null references public.attendance_sessions (id) on delete cascade,
  kind public.activity_kind not null,
  task_id uuid references public.tasks (id),
  general_type text,
  started_at timestamptz not null,
  ended_at timestamptz,
  split_from uuid references public.live_activity_segments (id),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at),
  check ((kind = 'task') = (task_id is not null)),
  check ((kind = 'general') = (general_type is not null)),
  constraint segments_no_overlap exclude using gist (
    user_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') with &&
  ) where (voided_at is null)
);
create unique index segments_one_open on public.live_activity_segments (user_id) where ended_at is null and voided_at is null;
create index segments_by_session on public.live_activity_segments (attendance_session_id);
create index segments_by_task on public.live_activity_segments (task_id) where task_id is not null;
create index segments_by_user_time on public.live_activity_segments (workspace_id, user_id, started_at);

-- ───────────── Standalone task time (Decisions 29–31, 40, 41) ─────────────
-- Independent of attendance; never payroll. Live task segments count as task time without a duplicate row here.
create table public.task_time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  task_id uuid not null references public.tasks (id),
  source public.time_entry_source not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  note text,
  overlap_acknowledged boolean not null default false,
  version integer not null default 1,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at),
  check (source = 'timer' or ended_at is not null)
);
create unique index task_timer_one_open on public.task_time_entries (user_id) where source = 'timer' and ended_at is null and voided_at is null;
create index task_time_by_task on public.task_time_entries (task_id);
create index task_time_by_user_time on public.task_time_entries (workspace_id, user_id, started_at);

-- ───────────── Weekly close and adjustments (Decision 109) ─────────────
create table public.week_closures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  week_start date not null,
  week_end date not null,
  active_working_days smallint not null,
  working_days_count smallint not null,
  target_seconds integer not null,
  closed_union_seconds integer not null,
  regular_seconds integer not null,
  overtime_seconds integer not null,
  excluded_open_session_ids uuid[] not null default '{}',
  source_fingerprint text not null,
  closed_at timestamptz not null default now(),
  unique (workspace_id, user_id, week_start),
  check (extract(dow from week_start) = 6),
  check (week_end = week_start + 6)
);

create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  source_week_start date not null,
  posted_week_start date not null,
  hours_delta_seconds integer not null,
  regular_delta_seconds integer not null,
  overtime_delta_seconds integer not null,
  cause_audit_event_id uuid references public.audit_events (id),
  created_at timestamptz not null default now(),
  check (posted_week_start > source_week_start),
  check (regular_delta_seconds <> 0 or overtime_delta_seconds <> 0)
);
create index on public.payroll_adjustments (workspace_id, user_id, posted_week_start);
create index on public.payroll_adjustments (workspace_id, user_id, source_week_start);

create trigger week_closures_append_only before update or delete on public.week_closures
  for each row execute function app.forbid_mutation();
create trigger payroll_adjustments_append_only before update or delete on public.payroll_adjustments
  for each row execute function app.forbid_mutation();

-- ───────────── RLS (read-only for clients; writes via RPCs) ─────────────
alter table public.weekly_target_settings enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.live_activity_segments enable row level security;
alter table public.task_time_entries enable row level security;
alter table public.week_closures enable row level security;
alter table public.payroll_adjustments enable row level security;

create policy target_settings_read on public.weekly_target_settings for select to authenticated
  using (app.is_member(workspace_id));
create policy attendance_read on public.attendance_sessions for select to authenticated
  using (app.can_view_user_work(workspace_id, user_id));
create policy segments_read on public.live_activity_segments for select to authenticated
  using (app.can_view_user_work(workspace_id, user_id));
create policy task_time_read on public.task_time_entries for select to authenticated
  using (app.can_view_user_work(workspace_id, user_id));
create policy closures_read on public.week_closures for select to authenticated
  using (app.can_view_user_work(workspace_id, user_id));
create policy adjustments_read on public.payroll_adjustments for select to authenticated
  using (app.can_view_user_work(workspace_id, user_id));

revoke all on public.weekly_target_settings, public.attendance_sessions, public.live_activity_segments,
  public.task_time_entries, public.week_closures, public.payroll_adjustments from anon;
revoke insert, update, delete, truncate on public.weekly_target_settings, public.attendance_sessions,
  public.live_activity_segments, public.task_time_entries, public.week_closures, public.payroll_adjustments from authenticated;
grant select on public.weekly_target_settings, public.attendance_sessions, public.live_activity_segments,
  public.task_time_entries, public.week_closures, public.payroll_adjustments to authenticated;

-- Realtime: manager live card and multi-device sync (Decisions 76, 81, 101).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.attendance_sessions, public.live_activity_segments, public.task_time_entries;
  end if;
end $$;
