"use client";

import { getBrowserClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/client/hooks";
import type {
  AuditEvent,
  Category,
  CompletionEvent,
  DeadlineChange,
  Deliverable,
  DeliverableEvidence,
  Dependency,
  RevisionRound,
  ScopeCycle,
  Task,
} from "@/lib/types";

export interface BoardData {
  tasks: Task[];
  categories: Category[];
  dependencies: Dependency[];
}

export async function loadBoard(workspaceId: string, includeArchived = false): Promise<BoardData> {
  const sb = getBrowserClient();
  let q = sb.from("tasks").select("*").eq("workspace_id", workspaceId).order("priority_rank", { nullsFirst: false }).order("created_at");
  if (!includeArchived) q = q.is("archived_at", null);
  const [tasks, categories, dependencies] = await Promise.all([
    q.returns<Task[]>(),
    sb.from("categories").select("*").eq("workspace_id", workspaceId).order("sort_order").returns<Category[]>(),
    sb.from("task_dependencies").select("task_id, depends_on_task_id").eq("workspace_id", workspaceId).returns<Dependency[]>(),
  ]);
  return { tasks: unwrap(tasks) ?? [], categories: unwrap(categories) ?? [], dependencies: unwrap(dependencies) ?? [] };
}

export interface TaskDetailData {
  task: Task;
  parent: Task | null;
  subtasks: Task[];
  deliverables: Deliverable[];
  evidence: DeliverableEvidence[];
  scopeCycles: ScopeCycle[];
  revisionRounds: RevisionRound[];
  completions: CompletionEvent[];
  deadlineChanges: DeadlineChange[];
  history: AuditEvent[];
  dependsOn: Task[];
  blocks: Task[];
}

export async function loadTaskDetail(taskId: string): Promise<TaskDetailData | null> {
  const sb = getBrowserClient();
  const task = unwrap(await sb.from("tasks").select("*").eq("id", taskId).maybeSingle<Task>());
  if (!task) return null;

  const [parent, subtasks, deliverables, scopeCycles, revisionRounds, completions, deadlineChanges, history, deps] = await Promise.all([
    task.parent_task_id ? sb.from("tasks").select("*").eq("id", task.parent_task_id).maybeSingle<Task>() : Promise.resolve({ data: null, error: null }),
    sb.from("tasks").select("*").eq("parent_task_id", taskId).order("created_at").returns<Task[]>(),
    sb.from("deliverables").select("*").eq("task_id", taskId).order("added_at").returns<Deliverable[]>(),
    sb.from("scope_cycles").select("*").eq("task_id", taskId).order("sequence").returns<ScopeCycle[]>(),
    sb.from("revision_rounds").select("*").eq("task_id", taskId).order("opened_at").returns<RevisionRound[]>(),
    sb.from("task_completion_events").select("*").eq("task_id", taskId).order("completed_at").returns<CompletionEvent[]>(),
    sb.from("deadline_changes").select("*").eq("task_id", taskId).order("changed_at").returns<DeadlineChange[]>(),
    sb.from("audit_events").select("*").eq("task_id", taskId).order("occurred_at", { ascending: false }).limit(200).returns<AuditEvent[]>(),
    sb.from("task_dependencies").select("task_id, depends_on_task_id").or(`task_id.eq.${taskId},depends_on_task_id.eq.${taskId}`).returns<Dependency[]>(),
  ]);

  const depRows = unwrap(deps) ?? [];
  const relatedIds = [...new Set(depRows.flatMap((d) => [d.task_id, d.depends_on_task_id]).filter((x) => x !== taskId))];
  const related = relatedIds.length ? (unwrap(await sb.from("tasks").select("*").in("id", relatedIds).returns<Task[]>()) ?? []) : [];
  const byId = new Map(related.map((t) => [t.id, t]));
  const deliverableRows = unwrap(deliverables) ?? [];
  const evidence = deliverableRows.length
    ? (unwrap(
        await sb
          .from("deliverable_evidence")
          .select("*")
          .in("deliverable_id", deliverableRows.map((d) => d.id))
          .order("created_at")
          .returns<DeliverableEvidence[]>(),
      ) ?? [])
    : [];

  return {
    task,
    parent: unwrap(parent as { data: Task | null; error: null }) ?? null,
    subtasks: unwrap(subtasks) ?? [],
    deliverables: deliverableRows,
    evidence,
    scopeCycles: unwrap(scopeCycles) ?? [],
    revisionRounds: unwrap(revisionRounds) ?? [],
    completions: unwrap(completions) ?? [],
    deadlineChanges: unwrap(deadlineChanges) ?? [],
    history: unwrap(history) ?? [],
    dependsOn: depRows.filter((d) => d.task_id === taskId).map((d) => byId.get(d.depends_on_task_id)).filter((t): t is Task => !!t),
    blocks: depRows.filter((d) => d.depends_on_task_id === taskId).map((d) => byId.get(d.task_id)).filter((t): t is Task => !!t),
  };
}

/** Suggested parent progress from subtasks (Decision 18A) — shown beside, never replacing, manual progress. */
export function suggestedProgress(subtasks: Task[]): number | null {
  const counted = subtasks.filter((s) => s.status !== "cancelled" && !s.archived_at);
  if (!counted.length) return null;
  const sum = counted.reduce((acc, s) => acc + (s.status === "completed" ? 100 : s.manual_progress), 0);
  return Math.round(sum / counted.length);
}
