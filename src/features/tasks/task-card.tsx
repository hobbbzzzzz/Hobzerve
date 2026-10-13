"use client";

import clsx from "clsx";
import { ProgressBar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { TreeStructure, Warning } from "@/components/icons";
import type { Category, Project, Task } from "@/lib/types";
import { ProjectBadge } from "@/features/projects/projects";
import { DueBadge, OriginBadge, PriorityBadge, StatusBadge } from "./badges";

export function TaskCard({
  task,
  category,
  project,
  subtaskCount,
  blocked,
  onOpen,
  showStatus,
  compact,
}: {
  task: Task;
  category?: Category;
  project?: Project;
  subtaskCount?: number;
  blocked?: boolean;
  onOpen: (t: Task) => void;
  showStatus?: boolean;
  compact?: boolean;
}) {
  const active = task.status === "in_progress" && task.queue === "active";
  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={clsx(
        "group flex w-full flex-col gap-3 rounded-[18px] border border-line bg-surface p-4 text-left transition-shadow hover:shadow-[var(--shadow-lift)]",
        active && "glow-active",
      )}
    >
      <div className="flex items-start gap-2">
        {task.priority_rank != null && (
          <span className="tabular mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-alt px-1.5 text-xs font-semibold text-primary-strong">
            <span className="sr-only">Rank </span>
            {task.priority_rank}
          </span>
        )}
        <p className="flex-1 font-bold leading-snug text-ink group-hover:text-primary-strong">{task.title}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {project && <ProjectBadge project={project} />}
        {showStatus && <StatusBadge status={task.status} />}
        <PriorityBadge level={task.priority_level} />
        <DueBadge task={task} />
        <OriginBadge task={task} />
        {category && <Badge>{category.name}</Badge>}
        {blocked && (
          <Badge tone="warning" icon={<Warning size={12} />}>
            Waiting on dependency
          </Badge>
        )}
        {!!subtaskCount && (
          <Badge icon={<TreeStructure size={12} />}>
            {subtaskCount} subtask{subtaskCount === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      {!compact && task.status !== "not_started" && task.status !== "cancelled" && (
        <ProgressBar value={task.manual_progress} label={`Progress of ${task.title}`} />
      )}
    </button>
  );
}
