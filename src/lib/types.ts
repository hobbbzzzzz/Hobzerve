// Hand-written row types for the Stage 1 schema. Regenerate with `supabase gen types` when convenient.

export type MemberRole = "employee" | "manager";
export type TaskQueue = "planned" | "active";
export type TaskStatus = "not_started" | "in_progress" | "on_hold" | "completed" | "cancelled";
export type TaskWorkType = "routine" | "one_off" | "major_project";
export type TaskComplexity = "simple" | "moderate" | "complex";
export type TaskOrigin = "assigned" | "employee_initiative";
export type PriorityLevel = "low" | "medium" | "high" | "urgent";
export type DeliverableKind = "expected" | "extra";
export type DeliverableOrigin = "self_initiated" | "manager_requested";
export type DeliverableStatus = "not_started" | "in_progress" | "delivered" | "not_applicable";

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
  settings: Record<string, unknown>;
}

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  job_title: string | null;
  preferences: { muted_event_types?: string[] } & Record<string, unknown>;
}

export interface Member {
  id: string;
  workspace_id: string;
  user_id: string;
  role: MemberRole;
  active_from: string;
  active_to: string | null;
}

export interface Category {
  id: string;
  workspace_id: string;
  name: string;
  sort_order: number;
  archived_at: string | null;
}

export interface Task {
  id: string;
  workspace_id: string;
  assignee_id: string;
  creator_id: string;
  parent_task_id: string | null;
  recurrence_template_id: string | null;
  occurrence_date: string | null;
  category_id: string | null;
  title: string;
  description: string;
  labels: string[];
  work_type: TaskWorkType;
  complexity: TaskComplexity;
  estimated_minutes: number | null;
  estimated_date: string | null;
  queue: TaskQueue;
  status: TaskStatus;
  manual_progress: number;
  priority_level: PriorityLevel;
  priority_rank: number | null;
  origin: TaskOrigin;
  original_due_at: string | null;
  current_due_at: string | null;
  current_scope_cycle_id: string | null;
  started_at: string | null;
  first_completed_at: string | null;
  last_completed_at: string | null;
  cancelled_at: string | null;
  archived_at: string | null;
  record_version: number;
  created_at: string;
  updated_at: string;
}

export interface Deliverable {
  id: string;
  task_id: string;
  scope_cycle_id: string;
  kind: DeliverableKind;
  origin: DeliverableOrigin | null;
  status: DeliverableStatus;
  title: string;
  description: string;
  added_by: string;
  added_at: string;
  delivered_at: string | null;
  archived_at: string | null;
  version: number;
}

export interface DeliverableEvidence {
  id: string;
  deliverable_id: string;
  url: string | null;
  note: string | null;
  added_by: string;
  created_at: string;
}

export interface ScopeCycle {
  id: string;
  task_id: string;
  sequence: number;
  type: "original" | "additional";
  reason: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface RevisionRound {
  id: string;
  scope_cycle_id: string;
  sequence: number;
  reason: string;
  opened_at: string;
  closed_at: string | null;
}

export interface CompletionEvent {
  id: string;
  task_id: string;
  scope_cycle_id: string;
  is_first_completion: boolean;
  completed_at: string;
  due_at_at_completion: string | null;
  progress_at_completion: number;
  missing_deliverable_reasons: Record<string, { title: string; reason: string }>;
  unfinished_subtask_reasons: Record<string, { title: string; reason: string }>;
  note: string | null;
}

export interface DeadlineChange {
  id: string;
  task_id: string;
  from_due_at: string | null;
  to_due_at: string | null;
  reason: string;
  actor_id: string;
  changed_at: string;
}

export interface AuditEvent {
  id: string;
  actor_id: string | null;
  subject_user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  task_id: string | null;
  event_type: string;
  summary: string;
  old_json: Record<string, unknown> | null;
  new_json: Record<string, unknown> | null;
  metadata_json: Record<string, unknown>;
  occurred_at: string;
}

export interface Notification {
  id: string;
  workspace_id: string;
  recipient_id: string;
  event_type: string;
  group_key: string;
  title: string;
  body: string | null;
  link: string | null;
  critical: boolean;
  read_at: string | null;
  created_at: string;
}

export interface Dependency {
  task_id: string;
  depends_on_task_id: string;
}

export interface RecurrenceTemplate {
  id: string;
  workspace_id: string;
  assignee_id: string;
  created_by: string;
  title: string;
  description: string;
  category_id: string | null;
  complexity: TaskComplexity;
  estimated_minutes: number | null;
  priority_level: PriorityLevel;
  frequency: "daily" | "weekly";
  days_of_week: number[];
  expected_deliverables: string[];
  due_local_time: string | null;
  starts_on: string;
  ends_on: string | null;
  enabled: boolean;
  archived_at: string | null;
}

export interface SessionContext {
  userId: string;
  profile: Profile;
  workspace: Workspace;
  role: MemberRole;
  members: Array<Member & { profile: Pick<Profile, "id" | "display_name" | "job_title" | "email"> }>;
}

// ───────────── Stage 2: attendance, activity, task time, payroll hours ─────────────
export type ActivityKind = "task" | "general" | "unassigned";

export interface AttendanceSession {
  id: string;
  workspace_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  origin: "clock" | "manual";
  summary: string | null;
  version: number;
  voided_at: string | null;
  void_reason: string | null;
}

export interface ActivitySegment {
  id: string;
  workspace_id: string;
  user_id: string;
  attendance_session_id: string;
  kind: ActivityKind;
  task_id: string | null;
  general_type: string | null;
  started_at: string;
  ended_at: string | null;
  split_from: string | null;
  voided_at: string | null;
}

export interface TaskTimeEntry {
  id: string;
  user_id: string;
  task_id: string;
  source: "timer" | "manual";
  started_at: string;
  ended_at: string | null;
  note: string | null;
  overlap_acknowledged: boolean;
  voided_at: string | null;
}

export interface PayrollAdjustment {
  id: string;
  source_week_start: string;
  posted_week_start: string;
  hours_delta_seconds: number;
  regular_delta_seconds: number;
  overtime_delta_seconds: number;
  cause_audit_event_id: string | null;
  created_at: string;
}

export interface WeekClosure {
  id: string;
  week_start: string;
  week_end: string;
  active_working_days: number;
  working_days_count: number;
  target_seconds: number;
  closed_union_seconds: number;
  regular_seconds: number;
  overtime_seconds: number;
  excluded_open_session_ids: string[];
  closed_at: string;
}

export interface WeekSummary {
  week_start: string;
  week_end: string;
  payroll_month: string;
  starts_at: string;
  ends_at: string;
  closes_at: string;
  status: "open" | "awaiting_close" | "closed";
  closure: WeekClosure | null;
  base_target_minutes: number;
  working_days: number[];
  active_working_days: number;
  target_seconds: number;
  closed_seconds: number;
  current_closed_seconds: number;
  provisional_open_seconds: number;
  regular_seconds: number;
  overtime_seconds: number;
  adjustments_in: PayrollAdjustment[];
  adjustments_out: PayrollAdjustment[];
  net_regular_seconds: number;
  net_overtime_seconds: number;
  fingerprint_changed: boolean | null;
}

export interface MonthOvertime {
  month: string;
  weeks: Array<{ week_start: string; status: WeekSummary["status"]; net_overtime_seconds: number; net_regular_seconds: number }>;
  net_overtime_seconds: number;
  final: boolean;
}

export interface TaskTime {
  direct_raw_seconds: number;
  direct_unique_seconds: number;
  rollup_raw_seconds: number;
  rollup_unique_seconds: number;
  running: boolean;
  estimated_minutes: number | null;
  entries: Array<{ id: string; task_id: string; source: "live" | "timer" | "manual"; started_at: string; ended_at: string | null; seconds: number }>;
}

export interface TargetSettings {
  id: string;
  workspace_id: string;
  effective_from: string;
  base_target_minutes: number;
  working_days: number[];
}
