"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc, unwrap } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import {
  addDays,
  cairoDayBounds,
  cairoToday,
  formatDateTime,
  formatDayLabel,
  formatDuration,
  formatTime,
  isoToCairoLocal,
  weekStartOf,
} from "@/lib/dates";
import { DOW_LABEL } from "@/lib/labels";
import type { ActivitySegment, AttendanceSession, MonthOvertime, Task, TaskTimeEntry, WeekSummary } from "@/lib/types";
import { ArrowCounterClockwise, CaretRight, Clock, Lock, PencilSimple, Plus, Prohibit, Stack, Tray, Warning } from "@/components/icons";
import { Timeline, TimelineLegend } from "./timeline";
import { useNow } from "./live";
import { ManualTimeDialog, RelabelDialog, RemoveSessionDialog, SessionDialog } from "./time-dialogs";
import { ReasonDialog } from "@/features/tasks/task-actions";

type TaskLite = Pick<Task, "id" | "title" | "parent_task_id" | "status">;

interface WeekData {
  summary: WeekSummary;
  month: MonthOvertime;
  sessions: AttendanceSession[];
  segments: ActivitySegment[];
  entries: TaskTimeEntry[];
  tasks: Map<string, TaskLite>;
  allTasks: TaskLite[];
}

async function loadWeek(workspaceId: string, userId: string, week: string): Promise<WeekData> {
  const sb = getBrowserClient();
  await sb.rpc("close_my_due_weeks", { p_workspace: workspaceId });
  const from = cairoDayBounds(week).start;
  const to = cairoDayBounds(addDays(week, 6)).end;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  const overlapping = `ended_at.is.null,ended_at.gt.${fromIso}`;
  const [summary, sessions, segments, entries, allTasks] = await Promise.all([
    sb.rpc("get_week_summary", { p_workspace: workspaceId, p_user: userId, p_week_start: week }),
    sb.from("attendance_sessions").select("*").eq("workspace_id", workspaceId).eq("user_id", userId).is("voided_at", null).lt("started_at", toIso).or(overlapping).order("started_at").returns<AttendanceSession[]>(),
    sb.from("live_activity_segments").select("*").eq("workspace_id", workspaceId).eq("user_id", userId).is("voided_at", null).lt("started_at", toIso).or(overlapping).order("started_at").returns<ActivitySegment[]>(),
    sb.from("task_time_entries").select("*").eq("workspace_id", workspaceId).eq("user_id", userId).is("voided_at", null).lt("started_at", toIso).or(overlapping).order("started_at").returns<TaskTimeEntry[]>(),
    sb.from("tasks").select("id, title, parent_task_id, status").eq("workspace_id", workspaceId).eq("assignee_id", userId).is("archived_at", null).order("created_at", { ascending: false }).limit(500).returns<TaskLite[]>(),
  ]);
  const s = unwrap(summary) as WeekSummary;
  const month = unwrap(await sb.rpc("get_month_overtime", { p_workspace: workspaceId, p_user: userId, p_month: `${s.payroll_month}-01` })) as MonthOvertime;
  const tasks = unwrap(allTasks) ?? [];
  const segs = unwrap(segments) ?? [];
  const ents = unwrap(entries) ?? [];
  const missing = [...new Set([...segs.map((x) => x.task_id), ...ents.map((x) => x.task_id)].filter((x): x is string => !!x && !tasks.some((t) => t.id === x)))];
  const extra = missing.length ? (unwrap(await sb.from("tasks").select("id, title, parent_task_id, status").in("id", missing).returns<TaskLite[]>()) ?? []) : [];
  return {
    summary: s,
    month,
    sessions: unwrap(sessions) ?? [],
    segments: segs,
    entries: ents,
    tasks: new Map([...tasks, ...extra].map((t) => [t.id, t])),
    allTasks: tasks,
  };
}

export function TimeScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { workspace, userId, isManager, employees, nameOf } = useWorkspace();
  const subject = isManager ? (params.get("user") ?? employees[0]?.user_id ?? null) : userId;
  const week = weekStartOf(params.get("week") ?? cairoToday());
  const now = useNow(30_000);
  const { data, loading, error } = useLoad(() => (subject ? loadWeek(workspace.id, subject, week) : Promise.resolve(null)), [workspace.id, subject, week]);
  const canEdit = subject === userId && !isManager;
  const [dialog, setDialog] = useState<
    | null
    | { kind: "add" }
    | { kind: "edit"; session: AttendanceSession }
    | { kind: "remove"; session: AttendanceSession }
    | { kind: "relabel"; segment: ActivitySegment }
    | { kind: "manual" }
  >(null);

  function go(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  if (!subject) {
    return <p className="text-sm text-ink-soft">There are no active employees in this workspace.</p>;
  }

  const s = data?.summary;
  const isCurrent = week === weekStartOf(cairoToday());

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Time</h1>
          <p className="text-sm text-ink-soft">
            Payable hours come only from closed attendance. Weeks run Saturday–Friday (Cairo) and close on the following Saturday at{" "}
            {String((workspace.settings?.weekly_close as { time?: string } | undefined)?.time ?? "23:59:59").slice(0, 5)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isManager && employees.length > 0 && (
            <Select aria-label="Employee" className="h-10 w-56" value={subject} onChange={(e) => go({ user: e.target.value })}>
              {employees.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.profile.display_name}
                </option>
              ))}
            </Select>
          )}
          {canEdit && (
            <>
              <Button icon={<Plus size={18} />} onClick={() => setDialog({ kind: "add" })}>
                Add Past Session
              </Button>
              <Button icon={<Clock size={18} />} onClick={() => setDialog({ kind: "manual" })}>
                Add Task Time
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-1">
          <IconButton label="Previous week" onClick={() => go({ week: addDays(week, -7) })}>
            <CaretRight size={18} className="rotate-180" />
          </IconButton>
          <p className="px-2 font-semibold">
            {formatDayLabel(week)} – {formatDayLabel(addDays(week, 6))}
          </p>
          <IconButton label="Next week" disabled={isCurrent} onClick={() => go({ week: addDays(week, 7) })}>
            <CaretRight size={18} />
          </IconButton>
          {!isCurrent && (
            <Button size="sm" variant="ghost" onClick={() => go({ week: weekStartOf(cairoToday()) })}>
              This Week
            </Button>
          )}
        </div>
        {s && <WeekStatus s={s} />}
      </div>

      {error && <p className="rounded-[14px] bg-danger-tint px-4 py-3 text-sm text-danger">{error}</p>}
      {!data && loading ? (
        <div className="py-12 text-center">
          <Spinner label="Loading week" />
        </div>
      ) : data && s ? (
        <>
          <SummaryCards s={s} />
          {(s.adjustments_in.length > 0 || s.adjustments_out.length > 0 || s.fingerprint_changed) && <AdjustmentsCard s={s} />}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
            <DaysCard
              week={week}
              data={data}
              now={now}
              canEdit={canEdit}
              onEdit={(session) => setDialog({ kind: "edit", session })}
              onRemove={(session) => setDialog({ kind: "remove", session })}
              onRelabel={(segment) => setDialog({ kind: "relabel", segment })}
            />
            <div className="flex flex-col gap-6">
              <MonthCard month={data.month} />
              <TaskTimeCard data={data} now={now} canEdit={canEdit} />
            </div>
          </div>
          {!canEdit && isManager && (
            <p className="text-xs text-ink-soft">
              You&apos;re viewing {nameOf(subject)}&apos;s time. Only the employee can correct attendance; every correction appears in the history and in your notifications.
            </p>
          )}
        </>
      ) : null}

      {dialog?.kind === "add" && <SessionDialog open onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <SessionDialog open onClose={() => setDialog(null)} session={dialog.session} />}
      {dialog?.kind === "remove" && <RemoveSessionDialog open onClose={() => setDialog(null)} session={dialog.session} />}
      {dialog?.kind === "relabel" && data && <RelabelDialog open onClose={() => setDialog(null)} segment={dialog.segment} tasksById={data.tasks} />}
      {dialog?.kind === "manual" && data && (
        <ManualTimeDialog open onClose={() => setDialog(null)} tasks={data.allTasks.filter((t) => t.status !== "completed" && t.status !== "cancelled")} />
      )}
    </div>
  );
}

function WeekStatus({ s }: { s: WeekSummary }) {
  if (s.status === "closed")
    return (
      <Badge tone="success" icon={<Lock size={12} />}>
        Closed {formatDateTime(s.closure?.closed_at)} · payroll month {s.payroll_month}
      </Badge>
    );
  if (s.status === "awaiting_close")
    return <Badge tone="warning">Ended — closes {formatDateTime(s.closes_at)}. Corrections now still change this week directly.</Badge>;
  return <Badge tone="primary">Open — closes {formatDateTime(s.closes_at)} · payroll month {s.payroll_month}</Badge>;
}

function daysLabel(days: number[]): string {
  return days.join(",") === "0,1,2,3,4" ? "Sun–Thu" : days.map((d) => DOW_LABEL[d]).join(", ");
}

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "primary" | "lavender" | "warning" }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p
        className={clsx(
          "tabular text-2xl font-bold",
          tone === "primary" && "text-primary-strong",
          tone === "lavender" && "text-lavender-ink",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

function SummaryCards({ s }: { s: WeekSummary }) {
  const prorated = s.active_working_days < s.working_days.length;
  const final = s.status === "closed";
  const adjReg = s.adjustments_in.reduce((a, x) => a + x.regular_delta_seconds, 0);
  const adjOt = s.adjustments_in.reduce((a, x) => a + x.overtime_delta_seconds, 0);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Stat
        label="Target"
        value={formatDuration(s.target_seconds)}
        hint={prorated ? `Prorated: ${s.active_working_days} of ${s.working_days.length} working days (${daysLabel(s.working_days)})` : `Working days ${daysLabel(s.working_days)}`}
      />
      <Stat label={final ? "Closed attendance (at close)" : "Closed attendance"} value={formatDuration(s.closed_seconds)} hint="Union of closed sessions in this week" />
      <Stat label="Regular" value={formatDuration(s.regular_seconds)} hint={final ? "Frozen at close" : "Provisional until the week closes"} tone="primary" />
      <Stat label="Overtime" value={formatDuration(s.overtime_seconds)} hint={final ? "Frozen at close" : "Provisional until the week closes"} tone="lavender" />
      <Stat
        label="Live, not payable yet"
        value={formatDuration(s.provisional_open_seconds)}
        hint="Open sessions count once they're closed"
        tone={s.provisional_open_seconds > 0 ? "warning" : undefined}
      />
      <Stat
        label="Net this week"
        value={
          <span className="flex flex-col">
            <span>{formatDuration(s.net_regular_seconds)}</span>
            <span className="text-sm font-semibold text-lavender-ink">+ {formatDuration(s.net_overtime_seconds)} overtime</span>
          </span>
        }
        hint={s.adjustments_in.length ? `Includes adjustments ${formatDuration(adjReg, { signed: true })} regular, ${formatDuration(adjOt, { signed: true })} OT` : "No adjustments posted here"}
      />
    </div>
  );
}

function AdjustmentsCard({ s }: { s: WeekSummary }) {
  return (
    <Card>
      <CardHeader icon={<ArrowCounterClockwise size={20} />} title="Adjustments" subtitle="Corrections to closed weeks are posted to the open week, never rewritten (Decision 109)" />
      <div className="grid gap-4 px-5 pb-5 text-sm md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Posted into This Week</h3>
          {s.adjustments_in.length === 0 ? (
            <p className="text-ink-soft">None.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {s.adjustments_in.map((a) => (
                <li key={a.id} className="tabular">
                  From week of{" "}
                  <Link href={`/time?week=${a.source_week_start}`} className="font-medium text-primary-strong hover:underline">
                    {formatDayLabel(a.source_week_start)}
                  </Link>
                  : {formatDuration(a.regular_delta_seconds, { signed: true })} regular, {formatDuration(a.overtime_delta_seconds, { signed: true })} overtime
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">Corrections to This Week</h3>
          {s.adjustments_out.length === 0 ? (
            <p className="text-ink-soft">None.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {s.adjustments_out.map((a) => (
                <li key={a.id} className="tabular">
                  {formatDuration(a.regular_delta_seconds, { signed: true })} regular, {formatDuration(a.overtime_delta_seconds, { signed: true })} overtime → posted to week of{" "}
                  <Link href={`/time?week=${a.posted_week_start}`} className="font-medium text-primary-strong hover:underline">
                    {formatDayLabel(a.posted_week_start)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {s.status === "closed" && s.current_closed_seconds !== s.closed_seconds && (
            <p className="mt-2 text-xs text-ink-soft">
              Attendance recorded for this week today: {formatDuration(s.current_closed_seconds)} (closed figure stays {formatDuration(s.closed_seconds)}).
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function DaysCard({
  week,
  data,
  now,
  canEdit,
  onEdit,
  onRemove,
  onRelabel,
}: {
  week: string;
  data: WeekData;
  now: number;
  canEdit: boolean;
  onEdit: (s: AttendanceSession) => void;
  onRemove: (s: AttendanceSession) => void;
  onRelabel: (s: ActivitySegment) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const workingDays = new Set(data.summary.working_days);
  return (
    <Card>
      <CardHeader icon={<Stack size={20} />} title="Days" subtitle="Sessions are split at midnight for display; the records themselves are unchanged" action={<TimelineLegend />} />
      <ul className="divide-y divide-line border-t border-line">
        {days.map((d) => {
          const { start, end } = cairoDayBounds(d);
          const sessions = data.sessions.filter((x) => Date.parse(x.started_at) < end && (x.ended_at ? Date.parse(x.ended_at) : now) > start);
          const segments = data.segments.filter((x) => Date.parse(x.started_at) < end && (x.ended_at ? Date.parse(x.ended_at) : now) > start);
          const closed = sessions.filter((x) => x.ended_at).reduce((a, x) => a + (Math.min(end, Date.parse(x.ended_at!)) - Math.max(start, Date.parse(x.started_at))) / 1000, 0);
          const live = sessions.filter((x) => !x.ended_at).reduce((a, x) => a + Math.max(0, Math.min(end, now) - Math.max(start, Date.parse(x.started_at))) / 1000, 0);
          const unassigned = segments
            .filter((x) => x.kind === "unassigned")
            .reduce((a, x) => a + Math.max(0, Math.min(end, x.ended_at ? Date.parse(x.ended_at) : now) - Math.max(start, Date.parse(x.started_at))) / 1000, 0);
          const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
          return (
            <li key={d} className="flex flex-col gap-3 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {formatDayLabel(d)}
                  {!workingDays.has(dow) && <span className="ml-2 text-xs font-normal text-ink-soft">Non-working day</span>}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {closed > 0 && <Badge tone="primary">{formatDuration(closed)}</Badge>}
                  {live > 0 && <Badge tone="warning">{formatDuration(live)} live</Badge>}
                  {unassigned > 0 && (
                    <Badge tone="warning" icon={<Warning size={12} />}>
                      {formatDuration(unassigned)} unassigned
                    </Badge>
                  )}
                  {sessions.length === 0 && <span className="text-xs text-ink-soft">No recorded attendance</span>}
                </div>
              </div>
              {sessions.length > 0 && (
                <>
                  <Timeline segments={segments} tasksById={data.tasks} from={start} to={end} now={now} showList={false} compact />
                  <ul className="flex flex-col gap-2">
                    {sessions.map((x) => (
                      <li key={x.id} className="rounded-[14px] border border-line p-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="tabular font-medium">
                            {formatTime(x.started_at)} – {x.ended_at ? formatTime(x.ended_at) : "open"}
                          </span>
                          {Date.parse(x.started_at) < start && <Badge>from previous day</Badge>}
                          {x.ended_at && Date.parse(x.ended_at) > end && <Badge>continues next day</Badge>}
                          {x.origin === "manual" && <Badge tone="lavender">Added later</Badge>}
                          {!x.ended_at && <Badge tone="warning">Open — not payable until closed</Badge>}
                          {canEdit && (
                            <span className="ml-auto flex gap-1">
                              <IconButton label="Correct session times" onClick={() => onEdit(x)}>
                                <PencilSimple size={18} />
                              </IconButton>
                              {x.ended_at && (
                                <IconButton label="Remove session" onClick={() => onRemove(x)}>
                                  <Prohibit size={18} />
                                </IconButton>
                              )}
                            </span>
                          )}
                        </div>
                        {x.summary && <p className="mt-1 text-sm text-ink-soft">“{x.summary}”</p>}
                        <ul className="mt-2 flex flex-col gap-1 text-sm">
                          {segments
                            .filter((g) => g.attendance_session_id === x.id)
                            .map((g) => {
                              const gs = Math.max(start, Date.parse(g.started_at));
                              const ge = Math.min(end, g.ended_at ? Date.parse(g.ended_at) : now);
                              const title = g.kind === "task" ? (data.tasks.get(g.task_id ?? "")?.title ?? "Task") : g.kind === "general" ? g.general_type : "Unassigned";
                              return (
                                <li key={g.id} className="flex items-center gap-2">
                                  <span
                                    className={clsx("size-2.5 shrink-0 rounded-full", g.kind === "task" ? "bg-primary" : g.kind === "general" ? "bg-teal" : "bg-warning")}
                                    aria-hidden
                                  />
                                  <span className="tabular w-24 shrink-0 text-ink-soft">
                                    {formatTime(new Date(gs).toISOString())}–{g.ended_at ? formatTime(new Date(ge).toISOString()) : "now"}
                                  </span>
                                  <span className={clsx("min-w-0 flex-1 truncate", g.kind === "unassigned" && "text-warning")}>
                                    {g.kind === "task" && g.task_id ? (
                                      <Link href={`/tasks/${g.task_id}`} className="hover:text-primary-strong">
                                        {title}
                                      </Link>
                                    ) : (
                                      title
                                    )}
                                  </span>
                                  <span className="tabular text-xs text-ink-soft">{formatDuration((ge - gs) / 1000)}</span>
                                  {canEdit && (
                                    <Button size="sm" variant="ghost" onClick={() => onRelabel(g)}>
                                      Re-label
                                    </Button>
                                  )}
                                </li>
                              );
                            })}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function MonthCard({ month }: { month: MonthOvertime }) {
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month.month}-15T12:00:00Z`));
  return (
    <Card>
      <CardHeader icon={<Tray size={20} />} title={`Overtime · ${label}`} subtitle="Each week counts in the month of its Friday" />
      <div className="flex flex-col gap-3 px-5 pb-5 text-sm">
        <ul className="flex flex-col gap-1.5">
          {month.weeks.map((w) => (
            <li key={w.week_start} className="flex items-center justify-between gap-2">
              <Link href={`/time?week=${w.week_start}`} className="min-w-0 truncate hover:text-primary-strong">
                {formatDayLabel(w.week_start)} – {formatDayLabel(addDays(w.week_start, 6))}
              </Link>
              <span className="tabular flex shrink-0 items-center gap-2 whitespace-nowrap">
                {formatDuration(w.net_overtime_seconds)}
                {w.status !== "closed" && <Badge tone="warning">provisional</Badge>}
              </span>
            </li>
          ))}
        </ul>
        <p className="tabular flex items-center justify-between border-t border-line pt-3 font-semibold">
          <span>Total overtime{month.final ? "" : " (so far)"}</span>
          <span>{formatDuration(month.net_overtime_seconds)}</span>
        </p>
        <p className="text-xs text-ink-soft">Hours only — Hobzerve never calculates pay amounts.</p>
      </div>
    </Card>
  );
}

function TaskTimeCard({ data, now, canEdit }: { data: WeekData; now: number; canEdit: boolean }) {
  const { call, pending } = useRpc();
  const [removing, setRemoving] = useState<string | null>(null);
  const rows = useMemo(() => {
    type Iv = [number, number];
    const per = new Map<string, Iv[]>();
    const add = (task: string, s: number, e: number) => {
      if (e <= s) return;
      per.set(task, [...(per.get(task) ?? []), [s, e]]);
    };
    const from = Date.parse(data.summary.starts_at);
    const to = Date.parse(data.summary.ends_at);
    for (const g of data.segments) if (g.kind === "task" && g.task_id) add(g.task_id, Math.max(from, Date.parse(g.started_at)), Math.min(to, g.ended_at ? Date.parse(g.ended_at) : now));
    for (const e of data.entries) add(e.task_id, Math.max(from, Date.parse(e.started_at)), Math.min(to, e.ended_at ? Date.parse(e.ended_at) : now));
    return [...per.entries()]
      .map(([task, ivs]) => {
        const raw = ivs.reduce((a, [s, e]) => a + (e - s), 0) / 1000;
        const sorted = [...ivs].sort((a, b) => a[0] - b[0]);
        let unique = 0;
        let cur: Iv | null = null;
        for (const iv of sorted) {
          if (!cur || iv[0] > cur[1]) {
            if (cur) unique += cur[1] - cur[0];
            cur = [iv[0], iv[1]];
          } else cur[1] = Math.max(cur[1], iv[1]);
        }
        if (cur) unique += cur[1] - cur[0];
        return { task, raw, unique: unique / 1000 };
      })
      .sort((a, b) => b.unique - a.unique);
  }, [data, now]);
  const unassigned = data.segments
    .filter((g) => g.kind === "unassigned")
    .reduce((a, g) => a + Math.max(0, Math.min(Date.parse(data.summary.ends_at), g.ended_at ? Date.parse(g.ended_at) : now) - Math.max(Date.parse(data.summary.starts_at), Date.parse(g.started_at))) / 1000, 0);

  return (
    <Card>
      <CardHeader icon={<Clock size={20} />} title="Task Time This Week" subtitle="Analysis only — never payable hours" />
      <div className="flex flex-col gap-3 px-5 pb-5 text-sm">
        {rows.length === 0 ? (
          <p className="text-ink-soft">No task time recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.task} className="flex items-start justify-between gap-2">
                <Link href={`/tasks/${r.task}`} className="min-w-0 truncate hover:text-primary-strong">
                  {data.tasks.get(r.task)?.title ?? "Task"}
                </Link>
                <span className="tabular shrink-0 text-right">
                  {formatDuration(r.unique)}
                  {Math.round(r.raw) !== Math.round(r.unique) && <span className="block text-xs text-warning">raw {formatDuration(r.raw)} (overlaps)</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {unassigned > 0 && (
          <p className="flex items-start gap-2 rounded-[12px] bg-warning-tint px-3 py-2 text-warning">
            <Warning size={16} className="mt-0.5 shrink-0" />
            {formatDuration(unassigned)} of attendance is unassigned this week. Re-label it from the day list.
          </p>
        )}
        {data.entries.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-ink-soft">Timers and manual entries ({data.entries.length})</summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {data.entries.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-xs">
                  <Badge tone={e.source === "timer" ? "lavender" : "neutral"}>{e.source}</Badge>
                  <span className="min-w-0 flex-1 truncate">{data.tasks.get(e.task_id)?.title ?? "Task"}</span>
                  <span className="tabular text-ink-soft">
                    {formatDayLabel(isoToCairoLocal(e.started_at).date)} {formatTime(e.started_at)}–{e.ended_at ? formatTime(e.ended_at) : "running"}
                  </span>
                  {e.overlap_acknowledged && <Badge tone="warning">overlap</Badge>}
                  {canEdit && e.ended_at && (
                    <IconButton
                      label="Remove entry"
                      disabled={pending}
                      onClick={() => setRemoving(e.id)}
                    >
                      <Prohibit size={16} />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <ReasonDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove Time Entry"
        description="The entry stays in the history but no longer counts as task time."
        label="Why remove it?"
        confirm="Remove"
        danger
        onSubmit={async (reason) => (await call("void_time_entry", { p_entry: removing, p_reason: reason }, { success: "Entry removed" })).ok}
      />
    </Card>
  );
}
