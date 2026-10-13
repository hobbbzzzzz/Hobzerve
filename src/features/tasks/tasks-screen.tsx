"use client";

import clsx from "clsx";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ProgressBar, Segmented, Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc } from "@/lib/client/hooks";
import { daysUntil } from "@/lib/dates";
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER, isOpenStatus } from "@/lib/labels";
import type { Category, Project, Task, TaskQueue, TaskStatus } from "@/lib/types";
import { ArrowDown, ArrowUp, DotsSixVertical, FolderSimple, Kanban, ListBullets, MagnifyingGlass, Plus, Tray } from "@/components/icons";
import { ProjectBadge, ProjectControls, ProjectDialog, ProjectIcon, useProjects } from "@/features/projects/projects";
import { loadBoard } from "./data";
import { TaskCard } from "./task-card";
import { TaskDrawer } from "./task-drawer";
import { NewTaskDialog } from "./task-form";
import { DueBadge, OriginBadge, PriorityBadge, StatusBadge } from "./badges";

type View = "kanban" | "list" | "projects";
type DeadlineFilter = "any" | "overdue" | "week" | "none";
type OriginFilter = "any" | "initiative" | "assigned" | "routine";

interface Filters {
  q: string;
  queue: "all" | TaskQueue;
  category: string;
  project: string;
  status: "any" | TaskStatus;
  priority: string;
  deadline: DeadlineFilter;
  origin: OriginFilter;
  creator: string;
  archived: boolean;
}

export function TasksScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { workspace, isManager, members, nameOf } = useWorkspace();
  const view: View = params.get("view") === "list" ? "list" : params.get("view") === "projects" ? "projects" : "kanban";
  const [filters, setFilters] = useState<Filters>({
    q: "",
    queue: (params.get("queue") as TaskQueue) || "all",
    category: "",
    project: "",
    status: "any",
    priority: "",
    deadline: "any",
    origin: "any",
    creator: "",
    archived: false,
  });
  const { projects } = useProjects();
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const [newTaskProject, setNewTaskProject] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(params.get("task"));
  const [creating, setCreating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const { data, loading, error } = useLoad(() => loadBoard(workspace.id, filters.archived), [workspace.id, filters.archived]);

  function setView(v: View) {
    const next = new URLSearchParams(params.toString());
    next.set("view", v);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const categoriesById = useMemo(() => new Map((data?.categories ?? []).map((c) => [c.id, c])), [data]);
  const subtaskCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data?.tasks ?? []) if (t.parent_task_id && !t.archived_at) m.set(t.parent_task_id, (m.get(t.parent_task_id) ?? 0) + 1);
    return m;
  }, [data]);
  const blocked = useMemo(() => {
    const statusById = new Map((data?.tasks ?? []).map((t) => [t.id, t.status]));
    const s = new Set<string>();
    for (const d of data?.dependencies ?? []) if (statusById.get(d.depends_on_task_id) !== "completed") s.add(d.task_id);
    return s;
  }, [data]);

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return (data?.tasks ?? []).filter((t) => {
      if (t.parent_task_id) return false;
      if (filters.archived ? !t.archived_at : t.archived_at) return false;
      if (q && !`${t.title} ${t.description} ${t.labels.join(" ")}`.toLowerCase().includes(q)) return false;
      if (filters.queue !== "all" && t.queue !== filters.queue) return false;
      if (filters.category && t.category_id !== filters.category) return false;
      if (filters.project && (t.project_id ?? "none") !== filters.project) return false;
      if (filters.status !== "any" && t.status !== filters.status) return false;
      if (filters.priority && t.priority_level !== filters.priority) return false;
      if (filters.creator && t.creator_id !== filters.creator) return false;
      if (filters.origin === "initiative" && t.origin !== "employee_initiative") return false;
      if (filters.origin === "assigned" && t.origin !== "assigned") return false;
      if (filters.origin === "routine" && !t.recurrence_template_id) return false;
      if (filters.deadline === "none" && t.current_due_at) return false;
      if (filters.deadline === "overdue" && !(t.current_due_at && isOpenStatus(t.status) && Date.parse(t.current_due_at) < Date.now())) return false;
      if (filters.deadline === "week" && !(t.current_due_at && daysUntil(t.current_due_at) >= 0 && daysUntil(t.current_due_at) <= 7)) return false;
      return true;
    });
  }, [data, filters]);

  const activeFilterCount =
    (filters.queue !== "all" ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.project ? 1 : 0) +
    (filters.status !== "any" ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.deadline !== "any" ? 1 : 0) +
    (filters.origin !== "any" ? 1 : 0) +
    (filters.creator ? 1 : 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tasks</h1>
          <p className="text-sm text-ink-soft">
            {isManager ? "Rank the queues and follow progress. The employee controls status and progress." : "Your board. The manager ranks the queues; you run the work."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "kanban", label: "Kanban", icon: <Kanban size={16} /> },
              { value: "list", label: "List", icon: <ListBullets size={16} /> },
              { value: "projects", label: "Projects", icon: <FolderSimple size={16} /> },
            ]}
          />
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
            New Task
          </Button>
        </div>
      </div>

      <div className="card flex flex-col gap-3 p-4">
        <div className="flex gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
          <Input aria-label="Search tasks" placeholder="Search title, description or label" className="pl-10" value={filters.q} onChange={(e) => set("q", e.target.value)} />
        </div>
          <Button className="sm:hidden" aria-expanded={showFilters} onClick={() => setShowFilters((x) => !x)}>
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </Button>
        </div>
        <div className={clsx("grid-cols-2 gap-2 sm:grid sm:grid-cols-4", showFilters ? "grid" : "hidden")}>
          <Select aria-label="Queue" value={filters.queue} onChange={(e) => set("queue", e.target.value as Filters["queue"])}>
            <option value="all">All queues</option>
            <option value="active">Active</option>
            <option value="planned">Planned</option>
          </Select>
          <Select aria-label="Category" value={filters.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">All categories</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Project" value={filters.project} onChange={(e) => set("project", e.target.value)}>
            <option value="">All projects</option>
            <option value="none">General tasks</option>
            {projects
              .filter((p) => !p.archived_at)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
          <Select aria-label="Status" value={filters.status} onChange={(e) => set("status", e.target.value as Filters["status"])}>
            <option value="any">Any status</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select aria-label="Priority" value={filters.priority} onChange={(e) => set("priority", e.target.value)}>
            <option value="">Any priority</option>
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
          <Select aria-label="Deadline" value={filters.deadline} onChange={(e) => set("deadline", e.target.value as DeadlineFilter)}>
            <option value="any">Any deadline</option>
            <option value="overdue">Overdue</option>
            <option value="week">Due in 7 days</option>
            <option value="none">No deadline</option>
          </Select>
          <Select aria-label="Origin" value={filters.origin} onChange={(e) => set("origin", e.target.value as OriginFilter)}>
            <option value="any">Any origin</option>
            <option value="initiative">Employee initiative</option>
            <option value="assigned">Manager request</option>
            <option value="routine">Routine</option>
          </Select>
          <Select aria-label="Creator" value={filters.creator} onChange={(e) => set("creator", e.target.value)}>
            <option value="">Any creator</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {nameOf(m.user_id)}
              </option>
            ))}
          </Select>
          <label className="flex h-11 items-center gap-2 rounded-[12px] border border-line px-3 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={filters.archived} onChange={(e) => set("archived", e.target.checked)} />
            Archived
          </label>
        </div>
        {activeFilterCount > 0 && (
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <Badge tone="primary">{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}</Badge>
            <button
              type="button"
              className="font-medium text-primary-strong hover:underline"
              onClick={() => setFilters((f) => ({ ...f, queue: "all", category: "", project: "", status: "any", priority: "", deadline: "any", origin: "any", creator: "" }))}
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {error && <p className="rounded-[14px] bg-danger-tint px-4 py-3 text-sm text-danger">{error}</p>}
      {!data && loading ? (
        <div className="py-10 text-center">
          <Spinner label="Loading tasks" />
        </div>
      ) : view === "projects" ? (
        <ProjectsView
          tasks={visible}
          projects={projects}
          categories={categoriesById}
          onOpen={(t) => setOpenTask(t.id)}
          onNewTask={(projectId) => {
            setNewTaskProject(projectId);
            setCreating(true);
          }}
        />
      ) : view === "kanban" ? (
        <KanbanView tasks={visible} categories={categoriesById} projects={projectsById} subtaskCount={subtaskCount} blocked={blocked} onOpen={(t) => setOpenTask(t.id)} />
      ) : (
        <ListView
          tasks={visible}
          allTasks={data?.tasks ?? []}
          filtered={activeFilterCount > 0 || filters.q.trim() !== "" || filters.archived}
          categories={categoriesById}
          projects={projectsById}
          onOpen={(t) => setOpenTask(t.id)}
        />
      )}

      {!!data && data.tasks.filter((t) => !t.parent_task_id).length === 0 && !filters.archived && (
        <EmptyState icon={<Tray size={24} />} title="No Tasks Yet" action={<Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>Create the First Task</Button>}>
          {isManager ? "Create a task and assign it to the employee." : "Create a task for yourself — it's tagged as your initiative."}
        </EmptyState>
      )}

      <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} categories={data?.categories ?? []} />
      <NewTaskDialog
        key={newTaskProject ?? "none"}
        open={creating}
        onClose={() => {
          setCreating(false);
          setNewTaskProject(null);
        }}
        categories={data?.categories ?? []}
        defaultQueue={filters.queue === "active" ? "active" : "planned"}
        defaultProject={newTaskProject}
      />
    </div>
  );
}

function KanbanView({
  tasks,
  categories,
  projects,
  subtaskCount,
  blocked,
  onOpen,
}: {
  tasks: Task[];
  categories: Map<string, Category>;
  projects: Map<string, Project>;
  subtaskCount: Map<string, number>;
  blocked: Set<string>;
  onOpen: (t: Task) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="grid min-w-[1100px] grid-cols-5 gap-4">
        {STATUS_ORDER.map((s) => {
          let col = tasks.filter((t) => t.status === s);
          if (s === "completed") col = col.sort((a, b) => (b.last_completed_at ?? "").localeCompare(a.last_completed_at ?? "")).slice(0, 30);
          else if (s === "cancelled") col = col.slice(0, 30);
          else col = col.sort((a, b) => (a.queue === b.queue ? (a.priority_rank ?? 1e9) - (b.priority_rank ?? 1e9) : a.queue === "active" ? -1 : 1));
          return (
            <section key={s} aria-label={STATUS_LABEL[s]} className="flex flex-col gap-3 rounded-[20px] bg-surface-alt/70 p-3">
              <header className="flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold">{STATUS_LABEL[s]}</h2>
                <span className="tabular text-xs font-medium text-ink-soft">{col.length}</span>
              </header>
              {col.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-ink-soft">Nothing here</p>
              ) : (
                col.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    category={t.category_id ? categories.get(t.category_id) : undefined}
                    project={t.project_id ? projects.get(t.project_id) : undefined}
                    subtaskCount={subtaskCount.get(t.id)}
                    blocked={blocked.has(t.id) && isOpenStatus(t.status)}
                    onOpen={onOpen}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ListView({
  tasks,
  allTasks,
  filtered,
  categories,
  projects,
  onOpen,
}: {
  tasks: Task[];
  allTasks: Task[];
  filtered: boolean;
  categories: Map<string, Category>;
  projects: Map<string, Project>;
  onOpen: (t: Task) => void;
}) {
  const open = tasks.filter((t) => isOpenStatus(t.status) && !t.archived_at);
  const closed = tasks.filter((t) => !isOpenStatus(t.status) || t.archived_at);
  return (
    <div className="flex flex-col gap-6">
      {(["active", "planned"] as TaskQueue[]).map((q) => (
        <QueueSection
          key={q}
          queue={q}
          tasks={open.filter((t) => t.queue === q).sort((a, b) => (a.priority_rank ?? 1e9) - (b.priority_rank ?? 1e9))}
          fullQueue={allTasks.filter((t) => !t.parent_task_id && !t.archived_at && isOpenStatus(t.status) && t.queue === q)}
          filtered={filtered}
          categories={categories}
          projects={projects}
          onOpen={onOpen}
        />
      ))}
      {closed.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">Closed and archived ({closed.length})</summary>
          <ul className="divide-y divide-line border-t border-line">
            {closed.map((t) => (
              <Row
                key={t.id}
                task={t}
                category={t.category_id ? categories.get(t.category_id) : undefined}
                project={t.project_id ? projects.get(t.project_id) : undefined}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function QueueSection({
  queue,
  tasks,
  fullQueue,
  filtered,
  categories,
  projects,
  onOpen,
}: {
  queue: TaskQueue;
  tasks: Task[];
  fullQueue: Task[];
  filtered: boolean;
  categories: Map<string, Category>;
  projects: Map<string, Project>;
  onOpen: (t: Task) => void;
}) {
  const { isManager, workspace } = useWorkspace();
  const { call, pending } = useRpc();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // Reordering needs the complete queue for one employee; disabled while filters hide part of it.
  const assignees = [...new Set(fullQueue.map((t) => t.assignee_id))];
  const canReorder = isManager && !filtered && assignees.length === 1;

  async function move(order: string[]) {
    await call("reorder_queue", { p_workspace: workspace.id, p_assignee: assignees[0], p_queue: queue, p_ordered: order }, { success: "Queue reordered" });
  }
  function shift(id: string, delta: number) {
    const order = tasks.map((t) => t.id);
    const i = order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    void move(order);
  }

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{queue === "active" ? "Active Queue" : "Planned Queue"}</h2>
          <p className="text-xs text-ink-soft">
            {isManager
              ? canReorder
                ? "Drag rows or use the arrows to rank. The employee is notified right away."
                : filtered
                  ? "Clear filters to reorder this queue."
                  : "Ranks are per employee."
              : "Ranked by your manager."}
          </p>
        </div>
        <span className="tabular text-sm text-ink-soft">{tasks.length}</span>
      </header>
      {tasks.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-soft">No open tasks in this queue.</p>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map((t, i) => (
            <Row
              key={t.id}
              task={t}
              category={t.category_id ? categories.get(t.category_id) : undefined}
              project={t.project_id ? projects.get(t.project_id) : undefined}
              onOpen={onOpen}
              dragging={dragId === t.id}
              over={overId === t.id && dragId !== t.id}
              draggable={canReorder && !pending}
              onDragStart={() => setDragId(t.id)}
              onDragEnter={() => setOverId(t.id)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDrop={() => {
                if (!dragId || dragId === t.id) return;
                const order = tasks.map((x) => x.id).filter((x) => x !== dragId);
                order.splice(order.indexOf(t.id), 0, dragId);
                setDragId(null);
                setOverId(null);
                void move(order);
              }}
              controls={
                canReorder ? (
                  <div className="flex">
                    <IconButton label={`Move ${t.title} up`} disabled={i === 0 || pending} onClick={() => shift(t.id, -1)}>
                      <ArrowUp size={16} />
                    </IconButton>
                    <IconButton label={`Move ${t.title} down`} disabled={i === tasks.length - 1 || pending} onClick={() => shift(t.id, 1)}>
                      <ArrowDown size={16} />
                    </IconButton>
                  </div>
                ) : null
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({
  task,
  category,
  project,
  showRank = true,
  onOpen,
  controls,
  draggable,
  dragging,
  over,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
}: {
  task: Task;
  category?: Category;
  project?: Project;
  showRank?: boolean;
  onOpen: (t: Task) => void;
  controls?: React.ReactNode;
  draggable?: boolean;
  dragging?: boolean;
  over?: boolean;
  onDragStart?: () => void;
  onDragEnter?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
}) {
  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => draggable && e.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
      className={clsx(
        "flex items-center gap-3 px-3 py-3 transition-colors sm:px-5",
        dragging && "opacity-50",
        over && "bg-surface-alt",
        draggable && "cursor-grab",
      )}
    >
      {draggable && <DotsSixVertical size={18} className="shrink-0 text-ink-soft" aria-hidden />}
      {showRank && <span className="tabular w-7 shrink-0 text-center text-sm font-semibold text-primary-strong">{task.priority_rank ?? "–"}</span>}
      <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
        <p className="truncate font-bold hover:text-primary-strong">{task.title}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {project && <ProjectBadge project={project} />}
          <StatusBadge status={task.status} />
          <PriorityBadge level={task.priority_level} />
          <DueBadge task={task} />
          <OriginBadge task={task} />
          {category && <Badge>{category.name}</Badge>}
        </div>
      </button>
      <div className="hidden w-36 shrink-0 md:block">
        <ProgressBar value={task.manual_progress} label={`Progress of ${task.title}`} />
      </div>
      {controls}
    </li>
  );
}

function ProjectsView({
  tasks,
  projects,
  categories,
  onOpen,
  onNewTask,
}: {
  tasks: Task[];
  projects: Project[];
  categories: Map<string, Category>;
  onOpen: (t: Task) => void;
  onNewTask: (projectId: string | null) => void;
}) {
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const live = tasks.filter((t) => !t.archived_at);
  const groups: Array<{ project: Project | null; open: Task[]; done: number }> = [...projects.filter((p) => !p.archived_at), null].map((project) => {
    const mine = live.filter((t) => (t.project_id ?? null) === (project?.id ?? null));
    return {
      project,
      open: mine
        .filter((t) => isOpenStatus(t.status))
        .sort((a, b) => (a.queue === b.queue ? (a.priority_rank ?? 1e9) - (b.priority_rank ?? 1e9) : a.queue === "active" ? -1 : 1)),
      done: mine.filter((t) => t.status === "completed").length,
    };
  });
  const archived = projects.filter((p) => p.archived_at);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">Open tasks grouped by project. Tasks without a project are general tasks.</p>
        <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing("new")}>
          New Project
        </Button>
      </div>

      {groups.map(({ project, open, done }) => (
        <section
          key={project?.id ?? "general"}
          className={clsx("card overflow-hidden", project && `project-${project.color}`)}
          // The project's colour as a rim along the top edge, matching its label.
          style={project ? { background: "linear-gradient(var(--project-dot), var(--project-dot)) top / 100% 3px no-repeat, var(--color-surface)" } : undefined}
          aria-label={project?.name ?? "General Tasks"}
        >
          <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
            <ProjectIcon project={project} />
            <div className="min-w-0 flex-1 basis-40">
              <h2 className="truncate text-base font-semibold">{project ? project.name : "General Tasks"}</h2>
              <p className="tabular text-xs text-ink-soft">
                {open.length} open · {done} completed
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" icon={<Plus size={16} />} onClick={() => onNewTask(project?.id ?? null)} aria-label={`Add task to ${project?.name ?? "general tasks"}`}>
                Add Task
              </Button>
              {project && <ProjectControls project={project} onEdit={setEditing} />}
            </div>
          </header>
          {open.length === 0 ? (
            <p className="px-5 py-5 text-sm text-ink-soft">No open tasks{project ? " in this project" : ""}.</p>
          ) : (
            <ul className="divide-y divide-line">
              {open.map((t) => (
                <Row key={t.id} task={t} showRank={false} category={t.category_id ? categories.get(t.category_id) : undefined} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </section>
      ))}

      {projects.length === 0 && (
        <EmptyState icon={<FolderSimple size={24} />} title="No Projects Yet" action={<Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing("new")}>Create a Project</Button>}>
          Group related tasks under a project. Its coloured label shows on every task inside it.
        </EmptyState>
      )}

      {archived.length > 0 && (
        <div className="card">
          <button type="button" className="w-full px-5 py-4 text-left text-sm font-semibold" aria-expanded={showArchived} onClick={() => setShowArchived((x) => !x)}>
            Archived Projects ({archived.length})
          </button>
          {showArchived && (
            <ul className="divide-y divide-line border-t border-line">
              {archived.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <ProjectBadge project={p} />
                  <span className="tabular flex-1 text-xs text-ink-soft">{live.filter((t) => t.project_id === p.id).length} tasks</span>
                  <ProjectControls project={p} onEdit={setEditing} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ProjectDialog open={editing !== null} onClose={() => setEditing(null)} project={editing === "new" ? null : editing} />
    </div>
  );
}
