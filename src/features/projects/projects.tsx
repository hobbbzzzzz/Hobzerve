"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc, unwrap } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import type { Project, ProjectColor } from "@/lib/types";
import { ArchiveBox, ArrowCounterClockwise, CheckCircle, FolderSimple, PencilSimple } from "@/components/icons";

// Fixed palette (mirrors the check constraint on projects.color). Each maps to a .project-<color> class in globals.css
// that sets label colours for light and dark mode.
export const PROJECT_COLORS: Array<{ value: ProjectColor; label: string }> = [
  { value: "blue", label: "Blue" },
  { value: "sky", label: "Sky" },
  { value: "teal", label: "Teal" },
  { value: "green", label: "Green" },
  { value: "lime", label: "Lime" },
  { value: "amber", label: "Amber" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" },
  { value: "pink", label: "Pink" },
  { value: "purple", label: "Purple" },
  { value: "violet", label: "Violet" },
  { value: "slate", label: "Slate" },
];

/** Every project in the workspace, archived ones included so existing task labels still resolve. */
export function useProjects() {
  const { workspace } = useWorkspace();
  const res = useLoad(
    async () => unwrap(await getBrowserClient().from("projects").select("*").eq("workspace_id", workspace.id).order("sort_order").returns<Project[]>()) ?? [],
    [workspace.id],
  );
  return { ...res, projects: res.data ?? [] };
}

export function ProjectBadge({ project, className }: { project: Pick<Project, "name" | "color">; className?: string }) {
  return (
    <span
      className={clsx(
        `project-${project.color}`,
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--project-bg)] px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-[var(--project-ink)]",
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-[var(--project-dot)]" aria-hidden />
      <span className="truncate">{project.name}</span>
    </span>
  );
}

export function GeneralTaskBadge() {
  return <Badge>General Task</Badge>;
}

/** Create a project, or rename / recolour / archive an existing one. */
export function ProjectDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project | null }) {
  const { workspace } = useWorkspace();
  const { call, pending } = useRpc();
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState<ProjectColor>(project?.color ?? "blue");
  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setColor(project?.color ?? "blue");
    }
  }, [open, project]);

  async function save() {
    const r = project
      ? await call("update_project", { p_project: project.id, p_name: name.trim(), p_color: color }, { success: "Project saved" })
      : await call("create_project", { p_workspace: workspace.id, p_name: name.trim(), p_color: color }, { success: "Project created" });
    if (r.ok) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? "Edit Project" : "New Project"}
      description="The project's label, in this colour, appears on every task inside it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} loading={pending} onClick={save}>
            {project ? "Save" : "Create Project"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Project name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />}</Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-ink">Label colour</legend>
          <div role="radiogroup" aria-label="Label colour" className="grid grid-cols-6 gap-2">
            {PROJECT_COLORS.map((c) => {
              const on = color === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setColor(c.value)}
                  className={clsx(
                    `project-${c.value}`,
                    "relative inline-flex h-10 items-center justify-center rounded-[12px] bg-[var(--project-bg)] text-[var(--project-ink)] transition-shadow",
                    on ? "ring-2 ring-[var(--project-dot)] ring-offset-2 ring-offset-surface" : "hover:ring-1 hover:ring-[var(--project-dot)]",
                  )}
                >
                  <span className="size-3.5 rounded-full bg-[var(--project-dot)]" aria-hidden />
                  {on && <CheckCircle size={14} className="absolute top-0.5 right-0.5" aria-hidden />}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Preview</p>
          <ProjectBadge project={{ name: name.trim() || "Project name", color }} />
        </div>
      </div>
    </Dialog>
  );
}

/** Edit / archive / restore controls shown in a project's header. */
export function ProjectControls({ project, onEdit }: { project: Project; onEdit: (p: Project) => void }) {
  const { call, pending } = useRpc();
  const archived = !!project.archived_at;
  return (
    <div className="flex items-center">
      {!archived && (
        <IconButton label={`Edit ${project.name}`} onClick={() => onEdit(project)}>
          <PencilSimple size={18} />
        </IconButton>
      )}
      <IconButton
        label={archived ? `Restore ${project.name}` : `Archive ${project.name}`}
        disabled={pending}
        onClick={() =>
          call("update_project", { p_project: project.id, p_archived: !archived }, { success: archived ? "Project restored" : "Project archived" })
        }
      >
        {archived ? <ArrowCounterClockwise size={18} /> : <ArchiveBox size={18} />}
      </IconButton>
    </div>
  );
}

export function ProjectIcon({ project }: { project: Pick<Project, "color"> | null }) {
  return (
    <span
      className={clsx(
        project ? `project-${project.color}` : undefined,
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full",
        project ? "bg-[var(--project-bg)] text-[var(--project-ink)]" : "bg-surface-alt text-ink-soft",
      )}
      aria-hidden
    >
      <FolderSimple size={20} />
    </span>
  );
}
