"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, unwrap } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatDate, timeAgo } from "@/lib/dates";
import { isOpenStatus } from "@/lib/labels";
import type { AuditEvent, Notification, Task } from "@/lib/types";
import { Bell, CalendarBlank, CaretRight, FlagBanner, Plus, Rocket } from "@/components/icons";
import { loadBoard } from "@/features/tasks/data";
import { TaskCard } from "@/features/tasks/task-card";
import { TaskDrawer } from "@/features/tasks/task-drawer";
import { NewTaskDialog } from "@/features/tasks/task-form";
import { DueBadge } from "@/features/tasks/badges";
import { ClockCard } from "@/features/time/clock-card";
import { LiveEmployeeCard } from "@/features/time/live-card";

export function DashboardScreen() {
  const { workspace, isManager, profile, employees, userId } = useWorkspace();
  const board = useLoad(() => loadBoard(workspace.id), [workspace.id]);
  const feed = useLoad(async () => {
    const sb = getBrowserClient();
    const [notifications, activity] = await Promise.all([
      sb.from("notifications").select("*").eq("recipient_id", userId).order("created_at", { ascending: false }).limit(6).returns<Notification[]>(),
      sb.from("audit_events").select("*").eq("workspace_id", workspace.id).order("occurred_at", { ascending: false }).limit(8).returns<AuditEvent[]>(),
    ]);
    return { notifications: unwrap(notifications) ?? [], activity: unwrap(activity) ?? [] };
  }, [workspace.id, userId]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Today's recurring instances (idempotent; pg_cron also runs this hourly when available).
  useEffect(() => {
    void getBrowserClient().rpc("generate_my_recurring_instances", { p_workspace: workspace.id });
  }, [workspace.id]);

  const tasks = useMemo(() => (board.data?.tasks ?? []).filter((t) => !t.parent_task_id && !t.archived_at), [board.data]);
  const active = tasks.filter((t) => t.queue === "active" && isOpenStatus(t.status)).sort((a, b) => (a.priority_rank ?? 1e9) - (b.priority_rank ?? 1e9));
  const deadlines = (board.data?.tasks ?? [])
    .filter((t) => !t.archived_at && isOpenStatus(t.status) && t.current_due_at && Date.parse(t.current_due_at) < Date.now() + 7 * 86400000)
    .sort((a, b) => Date.parse(a.current_due_at!) - Date.parse(b.current_due_at!));
  const overdue = deadlines.filter((t) => Date.parse(t.current_due_at!) < Date.now());
  const categories = board.data?.categories ?? [];
  const catById = new Map(categories.map((c) => [c.id, c]));
  const greeting = greet();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/calendar" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-primary-strong">
            <CalendarBlank size={14} /> {formatDate(new Date().toISOString())} · Cairo · open calendar
          </Link>
          <h1 className="text-2xl font-semibold">
            {greeting}, {profile.display_name.split(" ")[0]}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
            New Task
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {isManager ? (
            employees.length ? (
              employees.map((e) => <LiveEmployeeCard key={e.user_id} employeeId={e.user_id} />)
            ) : (
              <Card className="p-5 text-sm text-ink-soft">No active employees in this workspace.</Card>
            )
          ) : (
            <ClockCard />
          )}
        </div>

        <Card>
          <CardHeader icon={<CalendarBlank size={22} />} title="Deadlines" subtitle="Overdue and next 7 days" />
          <div className="px-5 pb-5">
            {board.loading && !board.data ? (
              <Spinner />
            ) : deadlines.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing due in the next 7 days.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {overdue.length > 0 && <li className="text-xs font-semibold text-danger">{overdue.length} overdue</li>}
                {deadlines.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setOpenTask(t.id)} className="flex w-full items-center justify-between gap-2 rounded-[12px] px-2 py-1.5 text-left hover:bg-surface-alt">
                      <span className="truncate text-sm">{t.title}</span>
                      <DueBadge task={t} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            icon={<Rocket size={22} />}
            title={isManager ? "Active Queue" : "Your Active Queue"}
            subtitle={isManager ? "Ranked by you" : "Ranked by your manager"}
            action={
              <Link href="/tasks?view=list" className="inline-flex items-center gap-1 text-sm font-medium text-primary-strong hover:underline">
                {isManager ? "Rank queue" : "All tasks"} <CaretRight size={14} />
              </Link>
            }
          />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {board.loading && !board.data ? (
              <Spinner />
            ) : active.length === 0 ? (
              <div className="sm:col-span-2">
                <EmptyState icon={<FlagBanner size={24} />} title="The Active Queue Is Empty">
                  {isManager ? "Create a task or ask the employee to promote planned work." : "Move something from Planned when you're ready to work on it."}
                </EmptyState>
              </div>
            ) : (
              active.slice(0, 6).map((t: Task) => (
                <TaskCard key={t.id} task={t} category={t.category_id ? catById.get(t.category_id) : undefined} onOpen={(x) => setOpenTask(x.id)} showStatus />
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<Bell size={22} />}
            title={isManager ? "Recent Activity" : "Notifications"}
            action={
              <Link href="/notifications" className="text-sm font-medium text-primary-strong hover:underline">
                See all
              </Link>
            }
          />
          <ul className="flex flex-col gap-3 px-5 pb-5 text-sm">
            {(isManager ? feed.data?.activity : feed.data?.notifications)?.length ? null : (
              <li className="text-ink-soft">{feed.loading ? "Loading…" : "Nothing yet."}</li>
            )}
            {isManager
              ? feed.data?.activity.map((a) => (
                  <li key={a.id} className="flex flex-col">
                    {a.task_id ? (
                      <Link href={`/tasks/${a.task_id}`} className="hover:text-primary-strong">
                        {a.summary}
                      </Link>
                    ) : (
                      <span>{a.summary}</span>
                    )}
                    <span className="text-xs text-ink-soft">{timeAgo(a.occurred_at)}</span>
                  </li>
                ))
              : feed.data?.notifications.map((n) => (
                  <li key={n.id} className="flex flex-col">
                    {n.link ? (
                      <Link href={n.link} className={n.read_at ? "hover:text-primary-strong" : "font-medium hover:text-primary-strong"}>
                        {n.title}
                      </Link>
                    ) : (
                      <span>{n.title}</span>
                    )}
                    <span className="text-xs text-ink-soft">{timeAgo(n.created_at)}</span>
                  </li>
                ))}
          </ul>
        </Card>
      </div>

      <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} categories={categories} />
      <NewTaskDialog open={creating} onClose={() => setCreating(false)} categories={categories} />
    </div>
  );
}

function greet() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Cairo" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
