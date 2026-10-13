# Hobzerve — Supabase PostgreSQL Logical Schema & Constraints
v0.3. Logical blueprint; migration scripts are written by the implementation agent. All tenant data includes workspace_id; UUID IDs and timestamptz unless marked. Durations stored as integer seconds.

## Core tables
- `workspaces(id, name, timezone default 'Africa/Cairo', week_start_day=SATURDAY, settings_json, created_at)`. `settings_json` holds the weekly close day/time (109, default Saturday 23:59:59) and PROPOSED configurable defaults: general-activity vocabulary, report auto-generation timing.
- `weekly_target_settings(id, workspace_id, effective_from date, base_target_minutes default 1200, working_days smallint[] default {0,1,2,3,4} (Sun=0..Thu=4), created_by, created_at)` — append-only; the row in effect on a week's Saturday applies to that week (110). Never alters closed weeks.
- `profiles(id → auth.users, display_name, nickname nullable, job_title, locale, preferences_json)`. `nickname` (≤40 chars) is set by the person (`set_nickname`) and used only in greetings and the user menu; records, reports and emails keep `display_name`.
- `workspace_members(id, workspace_id, user_id, role employee|manager, active_from date, active_to date nullable)` — effective dates drive proration (110). Optional `manager_employee_links` for future multi-team scope.
- `categories(id, workspace_id, name, archived_at, sort_order)`; `task_labels`.
- `projects(id, workspace_id, name, color, sort_order, created_by, archived_at, created_at)` — unique active name per workspace; `color` from a fixed set of 12 names (the app maps each to light/dark label colours). Both roles create, rename, recolour and archive (`create_project`, `update_project`). `tasks.project_id` nullable (null = general task); subtasks always carry their parent's project, and moving a parent moves its subtasks. Separate from categories: a category is the kind of work, a project is a specific initiative.
- `tasks(id, workspace_id, assignee_id, creator_id, parent_task_id nullable, recurring_instance_of nullable, category_id, title, description, work_type, complexity, estimated_minutes, queue, operational_status, manual_progress, priority_level, priority_rank, origin, original_due_at, current_due_at, started_at, first_completed_at, archived_at, record_version, created_at, updated_at)`. Parent in same workspace, one level deep in v1; no dependency cycles.
- `task_dependencies(task_id, depends_on_task_id)`; `recurrence_templates(id, workspace_id, frequency, template_payload, enabled, next_run_at)`; unique(template, scheduled_occurrence) on task instance.
- `scope_cycles(id, task_id, sequence, type original|additional, opened_at, closed_at, reason)`; `revision_rounds(id, scope_cycle_id, sequence, reason, opened_at, closed_at)`.
- `deliverables(id, task_id, scope_cycle_id, kind expected|extra, origin self_initiated|manager_requested nullable, status, title, description, expected_missing_reason, added_at, delivered_at, archived_at, version)`; `deliverable_evidence(id, deliverable_id, storage_path, created_at)`; `deliverable_revisions` immutable snapshots.
- `task_completion_events(id, task_id, scope_cycle_id, revision_round_id, completed_at, actor_id, due_at_at_completion, deliverable_snapshot_json, unfinished_subtask_reasons_json)` — immutable. `due_at_at_completion` of the first completion feeds "on-time at completion" (108). `tasks.first_completed_at` never erased on reopen.
- `deadline_changes(id, task_id, from_due_at, to_due_at, reason, actor_id, changed_at)` — immutable. `task_status_events` for hold, cancellation, reopen and activation reasons.
- `attendance_sessions(id, workspace_id, user_id, started_at, ended_at nullable, corrected_at, correction_reason, version, created_at)`; partial unique index (user_id) WHERE ended_at IS NULL; no-overlap enforced by transactional validation on closed sessions.
- `live_activity_segments(id, workspace_id, user_id, attendance_session_id, task_id nullable, kind task|subtask|general|unassigned, general_activity_type nullable, started_at, ended_at nullable, version, original_segment_id nullable)`; partial unique one open per user; interval inside its attendance session.
- `task_time_entries(id, workspace_id, user_id, task_id, source live|manual|standalone_timer, source_segment_id nullable, started_at, ended_at nullable, overlap_acknowledged, version)`; partial unique one open standalone timer per user; unique(source_segment_id) when non-null.

## Payroll-hours tables (109, 110)
- `week_closures(id, workspace_id, user_id, week_start date, week_end date, active_working_days, target_seconds, closed_union_seconds, regular_seconds, overtime_seconds, excluded_open_session_ids uuid[], source_fingerprint, closed_at)` — unique(user_id, week_start); immutable after insert (no UPDATE/DELETE grants, enforced by trigger).
- `payroll_adjustments(id, workspace_id, user_id, source_week_start date, posted_week_start date, regular_delta_seconds, overtime_delta_seconds, attendance_session_id, cause_audit_event_id, created_at)` — immutable; deltas may be negative; `posted_week_start` is always an open week.
- Correction RPCs determine which weeks an edit touches: open weeks are recomputed live; for each closed week touched, compute the hypothetical totals with the correction and insert one adjustment row with the deltas, in the same transaction as the correction and its audit event.

## Audit, notifications, reports
- `audit_events(id, workspace_id, actor_id, entity_type, entity_id, event_type, old_json, new_json, metadata_json, occurred_at, request_id unique nullable)` — append-only via privileged functions/triggers.
- `notifications(id, workspace_id, recipient_id, audit_event_id, group_key, payload_json, read_at, created_at)`.
- `email_deliveries(id, notification_id, batch_id, status pending|sent|failed, attempted_at, error)` — table may exist from Stage 1, unused until Stage 4 (113); no auto-retry.
- `report_snapshots(id, workspace_id, kind, subject_user_id, task_id, period_start, period_end, filters, title, source jsonb, source_fingerprint (SHA-256), renderer_version, auto, created_by, generated_at)` — append-only; the frozen source is rendered to PDF on download (111, 119 PROPOSED). Unique automatic snapshot per person, kind and period.

## Derived views/RPCs
`monthly_calendar_summary(subject_user, month)`, `daily_summary(subject_user, date)`, `weekly_attendance_totals` (open weeks live; closed weeks from `week_closures`), `weekly_payable_overtime` (closed totals + posted adjustments), `parent_subtask_time_rollups`, `monthly_task_metrics` (both on-time metrics), `report_source_fingerprint(report_kind, filters)`, `report_changed_since_snapshot`.

## Transactional operations
`clock_in`, `switch_activity`, `clock_out`, `correct_attendance`, `correct_activity_split`, `set_progress`, `reorder_queue`, `change_deadline`, `complete_task`, `reopen_task`, `archive_task`, `create_scope_change`, `close_week`.
- All authenticated/authorized; concurrency via version match/idempotency token. Mutation + audit + in-app notification commit atomically.
- `change_deadline` rejects with a typed error when the task's `operational_status = 'completed'` (108); a trigger guards the same rule against direct updates.
- `close_week(workspace, week_start)` is idempotent (unique constraint) and runs for every employee whose week ended. Scheduling (PROPOSED): Supabase `pg_cron` calling the function at the configured close time in Africa/Cairo, with a catch-up pass that closes any missed weeks. The same scheduler drives recurring-task generation and in-app report generation.

## Security
RLS on every workspace-owned table; restrictive role membership checks; seeded accounts created via admin API with passwords from env/dashboard; private Storage for evidence and reports. Service-role key server-only. SQL functions use pinned `search_path` and explicit authorization, never trusting client-supplied roles. No direct client writes to audit, week closures, payroll adjustments, report snapshots or other users' attendance. Test horizontal privilege escalation.
