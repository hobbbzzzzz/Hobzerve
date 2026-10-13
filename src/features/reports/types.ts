// Shapes of a stored report snapshot (public.report_snapshots + the frozen source from app.report_source).
// The source is produced by SQL, so fields are typed loosely and read defensively.

export type ReportKind = "daily" | "weekly" | "monthly" | "task" | "project";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ReportSnapshot {
  id: string;
  workspace_id: string;
  kind: ReportKind;
  subject_user_id: string;
  task_id: string | null;
  period_start: string | null;
  period_end: string | null;
  filters: Record<string, string>;
  title: string;
  source: Json;
  source_fingerprint: string;
  renderer_version: string;
  auto: boolean;
  created_by: string | null;
  generated_at: string;
  subject_name?: string;
  created_by_name?: string | null;
}

export type ReportListItem = Omit<ReportSnapshot, "source">;

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  task: "Task history",
  project: "Project",
};
