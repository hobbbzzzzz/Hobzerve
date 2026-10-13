"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatDateTime, formatMinutes, timeAgo } from "@/lib/dates";
import { COMPLEXITY_LABEL, WORK_TYPE_LABEL } from "@/lib/labels";
import type { Category, Task } from "@/lib/types";
import {
  CalendarBlank,
  CaretRight,
  CheckCircle,
  Clock,
  ListChecks,
  Note,
  PencilSimple,
  Plus,
  Stack,
  TreeStructure,
  X,
} from "@/components/icons";
import { loadTaskDetail, suggestedProgress, type TaskDetailData } from "./data";
import { DueBadge, LockedBadge, OriginBadge, PriorityBadge, StatusBadge } from "./badges";
import { ProgressControl, TaskActionBar } from "./task-actions";
import { DeliverablesPanel } from "./deliverables-panel";
import { EditTaskDialog, NewTaskDialog } from "./task-form";
import { TaskTimePanel } from "@/features/time/task-time-panel";

export function TaskDetailScreen({ taskId }: { taskId: string }) {
  const { workspace } = useWorkspace();
  const detail = useLoad(() => loadTaskDetail(taskId), [taskId]);
  const cats = useLoad(async () => {
    const { data } = await getBrowserClient().from("categories").select("*").eq("workspace_id", workspace.id).order("sort_order");
    return (data ?? []) as Category[];
  }, [workspace.id]);

  if (!detail.data && detail.loading)
    return (
      <div className="py-16 text-center">
        <Spinner label="Loading task" />
      </div>
    );
  if (detail.error) return <p className="rounded-[14px] bg-danger-tint px-4 py-3 text-sm text-danger">{detail.error}</p>;
  if (!detail.data)
    return (
      <EmptyState icon={<ListChecks size={24} />} title="Task Not Found" action={<Link href="/tasks" className="font-medium text-primary-strong">Back to tasks</Link>}>
        It may have been removed, or you don&apos;t have access to it.
      </EmptyState>
    );

  return <Detail data={detail.data} categories={cats.data ?? []} />;
}

function Detail({ data, categories }: { data: TaskDetailData; categories: Category[] }) {
  const { nameOf } = useWorkspace();
  const { task, parent, subtasks } = data;
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const locked = parent?.status === "completed";
  const category = categories.find((c) => c.id === task.category_id);
  const suggested = suggestedProgress(subtasks);
  const canAddSubtask = !task.parent_task_id && !task.archived_at && task.status !== "completed" && task.status !== "cancelled";

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-ink-soft">
        <Link href="/tasks" className="hover:text-primary-strong">
          Tasks
        </Link>
        {parent && (
          <>
            <CaretRight size={12} />
            <Link href={`/tasks/${parent.id}`} className="max-w-60 truncate hover:text-primary-strong">
              {parent.title}
            </Link>
          </>
        )}
        <CaretRight size={12} />
        <span className="max-w-60 truncate text-ink">{task.title}</span>
      </nav>

      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl leading-tight font-semibold">{task.title}</h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusBadge status={task.status} />
              <PriorityBadge level={task.priority_level} />
              <DueBadge task={task} />
              <OriginBadge task={task} />
              {locked && <LockedBadge />}
              {task.archived_at && <Badge tone="neutral">Archived</Badge>}
              {task.labels.map((l) => (
                <Badge key={l}>#{l}</Badge>
              ))}
            </div>
          </div>
          {!task.archived_at && (
            <Button size="sm" icon={<PencilSimple size={16} />} onClick={() => setEditing(true)}>
              Edit Details
            </Button>
          )}
        </div>
        <TaskActionBar task={task} parent={parent} deliverables={data.deliverables} subtasks={subtasks} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader icon={<Note size={20} />} title="Description" />
            <div className="px-5 pb-5">
              {task.description ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{task.description}</p>
              ) : (
                <p className="text-sm text-ink-soft">No description.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader icon={<CheckCircle size={20} />} title="Progress" />
            <div className="px-5 pb-5">
              <ProgressControl task={task} locked={locked} />
              {suggested != null && (
                <p className="mt-3 text-sm text-ink-soft">
                  Suggested from subtasks: <span className="tabular font-semibold text-ink">{suggested}%</span>. This is a reference only; the parent&apos;s
                  progress stays manual.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Clock size={20} />} title="Time" />
            <div className="px-5 pb-5">
              <TaskTimePanel task={task} subtasks={subtasks} locked={locked} />
            </div>
          </Card>

          <Card>
            <CardHeader icon={<ListChecks size={20} />} title="Deliverables" />
            <div className="px-5 pb-5">
              <DeliverablesPanel task={task} deliverables={data.deliverables} evidence={data.evidence} scopeCycles={data.scopeCycles} locked={locked} />
            </div>
          </Card>

          {!task.parent_task_id && (
            <Card>
              <CardHeader
                icon={<TreeStructure size={20} />}
                title="Subtasks"
                subtitle={subtasks.length ? `${subtasks.filter((s) => s.status === "completed").length} of ${subtasks.length} completed` : undefined}
                action={
                  canAddSubtask ? (
                    <Button size="sm" icon={<Plus size={16} />} onClick={() => setAddingSub(true)}>
                      Add Subtask
                    </Button>
                  ) : null
                }
              />
              <div className="px-5 pb-5">
                {task.status === "completed" && (
                  <p className="mb-3 text-xs text-ink-soft">This task is completed. Reopen it to add subtasks or continue unfinished ones.</p>
                )}
                {subtasks.length === 0 ? (
                  <p className="text-sm text-ink-soft">No subtasks.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {subtasks.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 rounded-[14px] border border-line px-3 py-2.5">
                        <Link href={`/tasks/${s.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary-strong">
                          {s.title}
                        </Link>
                        <span className="tabular hidden text-xs text-ink-soft sm:inline">{s.manual_progress}%</span>
                        <StatusBadge status={s.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          )}

          <DependenciesCard data={data} />
          <CompletionsCard data={data} />
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader icon={<Stack size={20} />} title="Details" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 pb-5 text-sm">
              <Info label="Assigned to">{nameOf(task.assignee_id)}</Info>
              <Info label="Created by">{nameOf(task.creator_id)}</Info>
              <Info label="Queue">
                {task.queue === "active" ? "Active" : "Planned"}
                {task.priority_rank ? ` · #${task.priority_rank}` : ""}
              </Info>
              <Info label="Category">{category?.name ?? "—"}</Info>
              <Info label="Work type">{WORK_TYPE_LABEL[task.work_type]}</Info>
              <Info label="Complexity">{COMPLEXITY_LABEL[task.complexity]}</Info>
              <Info label="Estimate">{formatMinutes(task.estimated_minutes)}</Info>
              <Info label="Started">{formatDateTime(task.started_at)}</Info>
              <Info label="First completed">{formatDateTime(task.first_completed_at)}</Info>
              <Info label="Created">{formatDateTime(task.created_at)}</Info>
            </dl>
          </Card>

          <Card>
            <CardHeader icon={<CalendarBlank size={20} />} title="Deadline History" subtitle="Cairo time" />
            <div className="px-5 pb-5 text-sm">
              <p>
                <span className="text-ink-soft">Current:</span> <span className="font-medium">{formatDateTime(task.current_due_at)}</span>
              </p>
              <p className="mb-3">
                <span className="text-ink-soft">Original:</span> {formatDateTime(task.original_due_at)}
              </p>
              {data.deadlineChanges.length === 0 ? (
                <p className="text-ink-soft">No changes.</p>
              ) : (
                <ol className="flex flex-col gap-3 border-l-2 border-line pl-4">
                  {data.deadlineChanges.map((c) => (
                    <li key={c.id}>
                      <p className="font-medium">
                        {formatDateTime(c.from_due_at)} → {formatDateTime(c.to_due_at)}
                      </p>
                      <p className="text-ink-soft">“{c.reason}”</p>
                      <p className="text-xs text-ink-soft">
                        {nameOf(c.actor_id)} · {formatDateTime(c.changed_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Clock size={20} />} title="History" />
            <ol className="flex max-h-[520px] flex-col gap-3 overflow-y-auto px-5 pb-5 text-sm">
              {data.history.length === 0 && <li className="text-ink-soft">No history yet.</li>}
              {data.history.map((h) => (
                <li key={h.id} className="flex flex-col">
                  <span>{h.summary}</span>
                  {typeof h.metadata_json?.body === "string" && h.metadata_json.body && (
                    <span className="text-ink-soft">“{h.metadata_json.body as string}”</span>
                  )}
                  <time className="text-xs text-ink-soft" dateTime={h.occurred_at} title={formatDateTime(h.occurred_at)}>
                    {timeAgo(h.occurred_at)}
                  </time>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      {editing && <EditTaskDialog open={editing} onClose={() => setEditing(false)} task={task} categories={categories} />}
      <NewTaskDialog open={addingSub} onClose={() => setAddingSub(false)} categories={categories} parent={task} />
    </div>
  );
}

function DependenciesCard({ data }: { data: TaskDetailData }) {
  const { workspace } = useWorkspace();
  const { call, pending } = useRpc();
  const [choice, setChoice] = useState("");
  const { task } = data;
  const candidates = useLoad(async () => {
    const { data: rows } = await getBrowserClient()
      .from("tasks")
      .select("id, title, status, parent_task_id")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .neq("id", task.id)
      .order("created_at", { ascending: false })
      .limit(200);
    return (rows ?? []) as Pick<Task, "id" | "title" | "status" | "parent_task_id">[];
  }, [workspace.id, task.id]);
  const existing = new Set(data.dependsOn.map((d) => d.id));

  return (
    <Card>
      <CardHeader icon={<TreeStructure size={20} />} title="Dependencies" subtitle="Warnings only — never blocks work" />
      <div className="flex flex-col gap-4 px-5 pb-5 text-sm">
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Depends On</h3>
          {data.dependsOn.length === 0 ? (
            <p className="text-ink-soft">None.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.dependsOn.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <Link href={`/tasks/${d.id}`} className="min-w-0 flex-1 truncate hover:text-primary-strong">
                    {d.title}
                  </Link>
                  <StatusBadge status={d.status} />
                  <IconButton
                    label={`Remove dependency on ${d.title}`}
                    disabled={pending}
                    onClick={() => call("remove_task_dependency", { p_task: task.id, p_depends_on: d.id }, { success: "Dependency removed" })}
                  >
                    <X size={16} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
        {data.blocks.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Other Tasks Waiting on This</h3>
            <ul className="flex flex-col gap-1.5">
              {data.blocks.map((d) => (
                <li key={d.id}>
                  <Link href={`/tasks/${d.id}`} className="hover:text-primary-strong">
                    {d.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!task.archived_at && (
          <div className="flex gap-2">
            <Select aria-label="Add a dependency" value={choice} onChange={(e) => setChoice(e.target.value)} className="h-9">
              <option value="">Add a task this depends on…</option>
              {(candidates.data ?? [])
                .filter((c) => !existing.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </Select>
            <Button
              size="sm"
              disabled={!choice}
              loading={pending}
              onClick={async () => {
                const r = await call("add_task_dependency", { p_task: task.id, p_depends_on: choice }, { success: "Dependency added" });
                if (r.ok) setChoice("");
              }}
            >
              Add
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function CompletionsCard({ data }: { data: TaskDetailData }) {
  const { scopeCycles, revisionRounds, completions } = data;
  if (completions.length === 0 && scopeCycles.length <= 1 && revisionRounds.length === 0) return null;
  return (
    <Card>
      <CardHeader icon={<CheckCircle size={20} />} title="Completions and Scope" subtitle="First completion counts once in analytics" />
      <div className="flex flex-col gap-4 px-5 pb-5 text-sm">
        {completions.map((c) => {
          const onTime = c.due_at_at_completion ? Date.parse(c.completed_at) <= Date.parse(c.due_at_at_completion) : null;
          const missing = Object.values(c.missing_deliverable_reasons ?? {});
          const subs = Object.values(c.unfinished_subtask_reasons ?? {});
          return (
            <div key={c.id} className="rounded-[14px] border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{formatDateTime(c.completed_at)}</span>
                <Badge tone={c.is_first_completion ? "primary" : "neutral"}>{c.is_first_completion ? "First completion" : "Re-completion"}</Badge>
                {onTime != null && <Badge tone={onTime ? "success" : "danger"}>{onTime ? "On time at completion" : "Late at completion"}</Badge>}
                <span className="tabular text-xs text-ink-soft">Progress {c.progress_at_completion}%</span>
              </div>
              {c.note && <p className="mt-2 text-ink-soft">“{c.note}”</p>}
              {missing.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-warning">Undelivered</p>
                  <ul className="mt-1 list-disc pl-5 text-ink-soft">
                    {missing.map((m, i) => (
                      <li key={i}>
                        {m.title}: {m.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {subs.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-warning">Unfinished subtasks</p>
                  <ul className="mt-1 list-disc pl-5 text-ink-soft">
                    {subs.map((m, i) => (
                      <li key={i}>
                        {m.title}: {m.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
        {scopeCycles.length > 1 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Scope Cycles</h3>
            <ol className="flex flex-col gap-1.5">
              {scopeCycles.map((s) => (
                <li key={s.id}>
                  Cycle {s.sequence} · {s.type === "original" ? "Original scope" : "Additional scope"} · opened {formatDateTime(s.opened_at)}
                  {s.reason ? ` — ${s.reason}` : ""}
                </li>
              ))}
            </ol>
          </div>
        )}
        {revisionRounds.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Revision Rounds</h3>
            <ol className="flex flex-col gap-1.5">
              {revisionRounds.map((r) => (
                <li key={r.id}>
                  Round {r.sequence} · {formatDateTime(r.opened_at)} — {r.reason}
                  {r.closed_at ? "" : " (open)"}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Card>
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
