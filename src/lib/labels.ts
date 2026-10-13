import type { DeliverableStatus, PriorityLevel, TaskComplexity, TaskStatus, TaskWorkType } from "./types";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const STATUS_ORDER: TaskStatus[] = ["not_started", "in_progress", "on_hold", "completed", "cancelled"];

export const PRIORITY_LABEL: Record<PriorityLevel, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
export const PRIORITY_ORDER: PriorityLevel[] = ["urgent", "high", "medium", "low"];

export const WORK_TYPE_LABEL: Record<TaskWorkType, string> = {
  routine: "Daily / Routine",
  one_off: "One-off",
  major_project: "Major project",
};

export const COMPLEXITY_LABEL: Record<TaskComplexity, string> = { simple: "Simple", moderate: "Moderate", complex: "Complex" };

export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  delivered: "Delivered",
  not_applicable: "Not applicable",
};

export const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isOpenStatus(s: TaskStatus): boolean {
  return s === "not_started" || s === "in_progress" || s === "on_hold";
}
