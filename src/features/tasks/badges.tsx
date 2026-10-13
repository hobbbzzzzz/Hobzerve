import { Badge, type Tone } from "@/components/ui/badge";
import { FlagBanner, Lock, Repeat, Sparkle, Warning } from "@/components/icons";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/labels";
import { relativeDue } from "@/lib/dates";
import type { PriorityLevel, Task, TaskStatus } from "@/lib/types";

const statusTone: Record<TaskStatus, Tone> = {
  not_started: "neutral",
  in_progress: "primary",
  on_hold: "warning",
  completed: "success",
  cancelled: "danger",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={statusTone[status]}>{STATUS_LABEL[status]}</Badge>;
}

const priorityTone: Record<PriorityLevel, Tone> = { low: "neutral", medium: "teal", high: "warning", urgent: "danger" };

export function PriorityBadge({ level }: { level: PriorityLevel }) {
  return (
    <Badge tone={priorityTone[level]} icon={<FlagBanner size={12} />}>
      {PRIORITY_LABEL[level]}
    </Badge>
  );
}

export function DueBadge({ task }: { task: Pick<Task, "current_due_at" | "status"> }) {
  if (!task.current_due_at) return null;
  if (task.status === "completed" || task.status === "cancelled") {
    return <Badge tone="neutral">Due {new Date(task.current_due_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Cairo" })}</Badge>;
  }
  const d = relativeDue(task.current_due_at);
  return (
    <Badge tone={d.tone === "overdue" ? "danger" : d.tone === "soon" ? "warning" : "neutral"} icon={d.tone === "overdue" ? <Warning size={12} /> : undefined}>
      {d.label}
    </Badge>
  );
}

export function OriginBadge({ task }: { task: Pick<Task, "origin" | "recurrence_template_id"> }) {
  if (task.recurrence_template_id) return <Badge tone="teal" icon={<Repeat size={12} />}>Routine</Badge>;
  if (task.origin === "employee_initiative") return <Badge tone="lavender" icon={<Sparkle size={12} />}>Initiative</Badge>;
  return null;
}

export function LockedBadge() {
  return (
    <Badge tone="warning" icon={<Lock size={12} />}>
      Parent completed
    </Badge>
  );
}
