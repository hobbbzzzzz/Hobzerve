"use client";

import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad } from "@/lib/client/hooks";
import { formatDateTime, formatMinutes } from "@/lib/dates";
import { COMPLEXITY_LABEL, WORK_TYPE_LABEL } from "@/lib/labels";
import type { Category } from "@/lib/types";
import { CaretRight } from "@/components/icons";
import { loadTaskDetail, suggestedProgress } from "./data";
import { DueBadge, OriginBadge, PriorityBadge, StatusBadge } from "./badges";
import { ProgressControl, TaskActionBar } from "./task-actions";
import { DeliverablesPanel } from "./deliverables-panel";
import { TaskTimePanel } from "@/features/time/task-time-panel";

/** Quick side panel for short edits (Decision 64). The full page holds history and everything else. */
export function TaskDrawer({ taskId, onClose, categories }: { taskId: string | null; onClose: () => void; categories: Category[] }) {
  return (
    <Drawer open={!!taskId} onClose={onClose} title="Task Details" headerExtra={taskId ? <FullPageLink id={taskId} /> : null}>
      {taskId && <DrawerBody taskId={taskId} categories={categories} />}
    </Drawer>
  );
}

function FullPageLink({ id }: { id: string }) {
  return (
    <Link href={`/tasks/${id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-strong hover:underline">
      Open full page <CaretRight size={14} />
    </Link>
  );
}

function DrawerBody({ taskId, categories }: { taskId: string; categories: Category[] }) {
  const { nameOf } = useWorkspace();
  const { data, error, loading } = useLoad(() => loadTaskDetail(taskId), [taskId]);

  if (!data && loading) return <div className="p-6"><Spinner /></div>;
  if (error) return <p className="p-6 text-sm text-danger">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-ink-soft">This task no longer exists or you don&apos;t have access to it.</p>;

  const { task, parent, subtasks } = data;
  const locked = parent?.status === "completed";
  const category = categories.find((c) => c.id === task.category_id);
  const suggested = suggestedProgress(subtasks);

  return (
    <div className="flex flex-col gap-6 p-5">
      <div className="flex flex-col gap-3">
        {parent && (
          <Link href={`/tasks/${parent.id}`} className="text-xs font-medium text-ink-soft hover:text-primary-strong">
            Subtask of {parent.title}
          </Link>
        )}
        <h2 className="text-xl leading-snug font-semibold">{task.title}</h2>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={task.status} />
          <PriorityBadge level={task.priority_level} />
          <DueBadge task={task} />
          <OriginBadge task={task} />
        </div>
      </div>

      <TaskActionBar task={task} parent={parent} deliverables={data.deliverables} subtasks={subtasks} />

      <div className="card p-4">
        <ProgressControl task={task} locked={locked} />
        {suggested != null && (
          <p className="mt-2 text-xs text-ink-soft">
            Suggested from subtasks: <span className="tabular font-medium">{suggested}%</span> (manual progress stays yours)
          </p>
        )}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Time</h3>
        <TaskTimePanel task={task} subtasks={subtasks} locked={locked} />
      </section>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Info label="Deadline (Cairo)">{formatDateTime(task.current_due_at)}</Info>
        <Info label="Queue">{task.queue === "active" ? "Active" : "Planned"}{task.priority_rank ? ` · #${task.priority_rank}` : ""}</Info>
        <Info label="Category">{category?.name ?? "—"}</Info>
        <Info label="Work type">{WORK_TYPE_LABEL[task.work_type]}</Info>
        <Info label="Complexity">{COMPLEXITY_LABEL[task.complexity]}</Info>
        <Info label="Estimate">{formatMinutes(task.estimated_minutes)}</Info>
        <Info label="Assigned to">{nameOf(task.assignee_id)}</Info>
        <Info label="Created by">{nameOf(task.creator_id)}</Info>
      </dl>

      {task.description && <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{task.description}</p>}

      {data.dependsOn.some((d) => d.status !== "completed") && (
        <p className="rounded-[14px] bg-warning-tint px-3 py-2 text-sm text-warning">
          Waiting on: {data.dependsOn.filter((d) => d.status !== "completed").map((d) => d.title).join(", ")}. You can still work and complete it.
        </p>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold">Deliverables</h3>
        <DeliverablesPanel task={task} deliverables={data.deliverables} evidence={data.evidence} scopeCycles={data.scopeCycles} locked={locked} compact />
      </section>

      {subtasks.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Subtasks</h3>
          <ul className="flex flex-col gap-1.5">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-[12px] bg-surface-alt px-3 py-2 text-sm">
                <Link href={`/tasks/${s.id}`} className="truncate hover:text-primary-strong">
                  {s.title}
                </Link>
                <StatusBadge status={s.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
