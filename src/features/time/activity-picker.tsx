"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { getBrowserClient } from "@/lib/supabase/client";
import { unwrap, useLoad } from "@/lib/client/hooks";
import type { ActivityKind, Task } from "@/lib/types";
import { CircleDashed, ListChecks, MagnifyingGlass, Note, Tray, Warning } from "@/components/icons";

export interface ActivityChoice {
  kind: ActivityKind;
  taskId?: string | null;
  generalType?: string | null;
  label: string;
}

type PickTask = Pick<Task, "id" | "title" | "parent_task_id" | "status" | "queue" | "priority_rank" | "archived_at">;

/** One-tap activity switcher: open it, pick a line — two actions (DESIGN_SYSTEM.md). */
export function ActivityPicker({
  open,
  onClose,
  onPick,
  title = "What are you working on?",
  current,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (choice: ActivityChoice) => void;
  title?: string;
  current?: { kind: ActivityKind; taskId: string | null; generalType: string | null } | null;
}) {
  const { workspace, userId } = useWorkspace();
  const [q, setQ] = useState("");
  const tasks = useLoad(async () => {
    if (!open) return [] as PickTask[];
    return (
      unwrap(
        await getBrowserClient()
          .from("tasks")
          .select("id, title, parent_task_id, status, queue, priority_rank, archived_at")
          .eq("workspace_id", workspace.id)
          .eq("assignee_id", userId)
          .is("archived_at", null)
          .in("status", ["not_started", "in_progress", "on_hold"])
          .order("priority_rank", { nullsFirst: false })
          .returns<PickTask[]>(),
      ) ?? []
    );
  }, [open, workspace.id, userId]);

  const groups = useMemo(() => {
    const generalTypes = (workspace.settings?.general_activity_types as string[] | undefined) ?? ["Meeting", "Planning", "Research", "Administration", "Other"];
    const all = tasks.data ?? [];
    const needle = q.trim().toLowerCase();
    const match = (t: PickTask) => !needle || t.title.toLowerCase().includes(needle);
    const tops = all.filter((t) => !t.parent_task_id);
    const subsOf = (id: string) => all.filter((s) => s.parent_task_id === id);
    const build = (queue: "active" | "planned") =>
      tops
        .filter((t) => t.queue === queue)
        .flatMap((t) => [t, ...subsOf(t.id)])
        .filter(match);
    return { active: build("active"), planned: build("planned"), general: generalTypes.filter((g) => !needle || g.toLowerCase().includes(needle)) };
  }, [tasks.data, q, workspace.settings]);

  const isCurrent = (kind: ActivityKind, taskId?: string | null, general?: string | null) =>
    !!current && current.kind === kind && (current.taskId ?? null) === (taskId ?? null) && (current.generalType ?? null) === (general ?? null);

  return (
    <Dialog open={open} onClose={onClose} title={title} description="Pick one. Switching closes the current activity and starts this one at the same moment.">
      <div className="flex flex-col gap-4">
        <div className="relative">
          <MagnifyingGlass size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
          <Input aria-label="Filter activities" placeholder="Filter" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        {tasks.loading && !tasks.data ? (
          <Spinner />
        ) : (
          <>
            <Section title="Active queue">
              {groups.active.length === 0 && <Empty>No active tasks.</Empty>}
              {groups.active.map((t) => (
                <Option
                  key={t.id}
                  icon={<ListChecks size={18} />}
                  label={t.title}
                  indent={!!t.parent_task_id}
                  note={t.status === "on_hold" ? "On hold" : t.status === "not_started" ? "Not started" : undefined}
                  current={isCurrent("task", t.id)}
                  onClick={() => onPick({ kind: "task", taskId: t.id, label: t.title })}
                />
              ))}
            </Section>
            {groups.planned.length > 0 && (
              <Section title="Planned (you'll see a warning)">
                {groups.planned.map((t) => (
                  <Option
                    key={t.id}
                    icon={<Warning size={18} className="text-warning" />}
                    label={t.title}
                    indent={!!t.parent_task_id}
                    current={isCurrent("task", t.id)}
                    onClick={() => onPick({ kind: "task", taskId: t.id, label: t.title })}
                  />
                ))}
              </Section>
            )}
            <Section title="General activity">
              {groups.general.map((g) => (
                <Option key={g} icon={<Note size={18} />} label={g} current={isCurrent("general", null, g)} onClick={() => onPick({ kind: "general", generalType: g, label: g })} />
              ))}
            </Section>
            <Section title="Not sure yet">
              <Option
                icon={<CircleDashed size={18} />}
                label="Unassigned"
                note="Counts as attendance, not task time. You can re-label it later."
                current={isCurrent("unassigned")}
                onClick={() => onPick({ kind: "unassigned", label: "Unassigned" })}
              />
            </Section>
          </>
        )}
      </div>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">{title}</h3>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm text-ink-soft">
      <Tray size={16} /> {children}
    </li>
  );
}

function Option({
  icon,
  label,
  note,
  indent,
  current,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  note?: string;
  indent?: boolean;
  current?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={current}
        className={clsx(
          "flex w-full items-start gap-3 rounded-[12px] px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-alt disabled:cursor-default",
          indent && "pl-9",
          current && "bg-surface-alt",
        )}
      >
        <span className="mt-0.5 text-primary-strong">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{label}</span>
          {note && <span className="block text-xs text-ink-soft">{note}</span>}
        </span>
        {current && <span className="text-xs font-medium text-primary-strong">Current</span>}
      </button>
    </li>
  );
}
