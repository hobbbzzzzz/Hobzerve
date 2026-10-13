"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { addDays, cairoToday, formatDayLabel, formatDuration, formatTime } from "@/lib/dates";
import { STATUS_LABEL } from "@/lib/labels";
import type { ActivitySegment, TaskStatus } from "@/lib/types";
import {
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Clock,
  FlagBanner,
  ListChecks,
  Lock,
  Note,
  Stack,
  Warning,
} from "@/components/icons";
import { Timeline, TimelineLegend } from "@/features/time/timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const DOW = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-15T12:00:00Z`));
const shiftMonth = (m: string, n: number) => {
  const d = new Date(`${m}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getBrowserClient().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function CalendarScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { workspace, userId, isManager, employees } = useWorkspace();
  const subject = isManager ? (params.get("user") ?? employees[0]?.user_id ?? null) : userId;
  const date = params.get("date") ?? cairoToday();
  const month = params.get("month") ?? date.slice(0, 7);

  const cal = useLoad(() => (subject ? rpc<Json>("get_month_calendar", { p_workspace: workspace.id, p_user: subject, p_month: `${month}-01` }) : Promise.resolve(null)), [
    workspace.id,
    subject,
    month,
  ]);
  const dayData = useLoad(() => (subject ? rpc<Json>("get_day_summary", { p_workspace: workspace.id, p_user: subject, p_date: date }) : Promise.resolve(null)), [
    workspace.id,
    subject,
    date,
  ]);

  function go(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }
  const selectDate = (d: string) => go({ date: d, month: d.slice(0, 7) });

  if (!subject) return <p className="text-sm text-ink-soft">There are no active employees in this workspace.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-ink-soft">Pick any day to see what was recorded. Days follow Cairo time; weeks run Saturday–Friday.</p>
        </div>
        {isManager && employees.length > 0 && (
          <Select aria-label="Employee" className="h-10 w-56" value={subject} onChange={(e) => go({ user: e.target.value })}>
            {employees.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.profile.display_name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Card className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <IconButton label="Previous month" onClick={() => go({ month: shiftMonth(month, -1) })}>
                <CaretLeft size={18} />
              </IconButton>
              <h2 className="min-w-40 text-center text-lg font-semibold" aria-live="polite">
                {monthLabel(month)}
              </h2>
              <IconButton label="Next month" onClick={() => go({ month: shiftMonth(month, 1) })}>
                <CaretRight size={18} />
              </IconButton>
            </div>
            <Button size="sm" icon={<CalendarBlank size={16} />} onClick={() => selectDate(cairoToday())}>
              Today
            </Button>
          </div>
          {!cal.data && cal.loading ? (
            <div className="py-16 text-center">
              <Spinner label="Loading month" />
            </div>
          ) : cal.error ? (
            <p className="text-sm text-danger">{cal.error}</p>
          ) : cal.data ? (
            <MonthGrid days={cal.data.days} selected={date} onSelect={selectDate} />
          ) : null}
          <Legend />
        </Card>

        <DayPanel
          date={date}
          data={dayData.data}
          loading={dayData.loading}
          error={dayData.error}
          canCorrect={!isManager && subject === userId}
          onPrev={() => selectDate(addDays(date, -1))}
          onNext={() => selectDate(addDays(date, 1))}
        />
      </div>
    </div>
  );
}

function MonthGrid({ days, selected, onSelect }: { days: Json[]; selected: string; onSelect: (d: string) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusAfterMove = useRef(false);
  useEffect(() => {
    if (focusAfterMove.current) {
      refs.current[selected]?.focus();
      focusAfterMove.current = false;
    }
  }, [selected, days]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    focusAfterMove.current = true;
    onSelect(addDays(selected, step));
  }

  const selectedInGrid = days.some((d) => d.date === selected);
  return (
    <div role="grid" aria-label="Month" onKeyDown={onKey}>
      <div role="row" className="mb-1 grid grid-cols-7 gap-1">
        {DOW.map((d) => (
          <div key={d} role="columnheader" className="py-1 text-center text-xs font-medium text-ink-soft">
            {d}
          </div>
        ))}
      </div>
      {Array.from({ length: 6 }, (_, w) => (
        <div role="row" key={w} className="grid grid-cols-7 gap-1">
          {days.slice(w * 7, w * 7 + 7).map((d: Json, i: number) => {
            const isSel = d.date === selected;
            const future = d.state === "future";
            const outside = d.state === "outside_membership";
            const hasWork = d.closed_seconds > 0 || d.live_seconds > 0 || d.worked_count > 0;
            const label = [
              formatDayLabel(d.date),
              outside ? "outside membership" : future ? "future" : hasWork ? `${formatDuration(d.closed_seconds)} attendance, ${d.worked_count} tasks worked on` : "no recorded work",
              d.unassigned_seconds > 0 ? "has unassigned time" : "",
              d.due_count ? `${d.due_count} due` : "",
              d.week_closed ? "week closed" : "",
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <div role="gridcell" key={d.date} aria-selected={isSel}>
                <button
                  type="button"
                  ref={(el) => {
                    refs.current[d.date] = el;
                  }}
                  tabIndex={isSel || (!selectedInGrid && w === 0 && i === 0) ? 0 : -1}
                  aria-label={label}
                  onClick={() => onSelect(d.date)}
                  className={clsx(
                    "relative flex h-20 w-full flex-col items-start rounded-[12px] border p-1.5 text-left transition-colors sm:h-24 sm:p-2",
                    isSel ? "border-primary bg-selected shadow-[var(--shadow-glow)]" : "border-line bg-surface hover:bg-surface-alt",
                    !d.in_month && !isSel && "border-dashed bg-surface-alt/50",
                    outside && "bg-[repeating-linear-gradient(135deg,#f4f6fb_0_6px,#ffffff_6px_12px)]",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <span
                      className={clsx(
                        "tabular inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                        d.is_today ? "bg-primary-gradient text-white" : d.working_day ? "text-ink" : "text-ink-soft",
                      )}
                    >
                      {Number(d.date.slice(8))}
                    </span>
                    {d.week_closed && <Lock size={11} className="text-ink-soft" aria-hidden />}
                  </span>
                  {!future && !outside && d.closed_seconds + d.live_seconds > 0 && (
                    <span className="tabular mt-auto text-[11px] font-semibold text-primary-strong">{formatDuration(d.closed_seconds + d.live_seconds)}</span>
                  )}
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-ink-soft">
                    {d.worked_count > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <ListChecks size={10} aria-hidden />
                        {d.worked_count}
                      </span>
                    )}
                    {d.completions > 0 && <CheckCircle size={10} className="text-success" aria-hidden />}
                    {d.unassigned_seconds > 0 && <Warning size={10} className="text-warning" aria-hidden />}
                    {d.due_count > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-lavender-ink">
                        <FlagBanner size={10} aria-hidden />
                        {d.due_count}
                      </span>
                    )}
                    {d.live_seconds > 0 && <span className="size-1.5 animate-pulse rounded-full bg-warning" aria-hidden />}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-soft">
      <li className="inline-flex items-center gap-1">
        <span className="tabular font-semibold text-primary-strong">6h 30m</span> attendance
      </li>
      <li className="inline-flex items-center gap-1">
        <ListChecks size={12} /> tasks worked on
      </li>
      <li className="inline-flex items-center gap-1">
        <CheckCircle size={12} className="text-success" /> completion
      </li>
      <li className="inline-flex items-center gap-1">
        <Warning size={12} className="text-warning" /> unassigned time
      </li>
      <li className="inline-flex items-center gap-1">
        <FlagBanner size={12} className="text-lavender-ink" /> open tasks due
      </li>
      <li className="inline-flex items-center gap-1">
        <Lock size={12} /> week closed
      </li>
    </ul>
  );
}

function DayPanel({
  date,
  data,
  loading,
  error,
  canCorrect,
  onPrev,
  onNext,
}: {
  date: string;
  data: Json;
  loading: boolean;
  error: string | null;
  canCorrect: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const now = Date.now();
  const segments: ActivitySegment[] = useMemo(
    () =>
      (data?.segments ?? []).map((s: Json) => ({
        id: s.id,
        workspace_id: "",
        user_id: "",
        attendance_session_id: s.attendance_session_id,
        kind: s.kind,
        task_id: s.task_id,
        general_type: s.general_type,
        started_at: s.from,
        ended_at: s.open ? null : s.to,
        split_from: null,
        voided_at: null,
      })),
    [data],
  );
  const tasksById = useMemo(
    () => new Map<string, { title: string; parent_task_id: string | null }>((data?.segments ?? []).filter((s: Json) => s.task_id).map((s: Json) => [s.task_id, { title: s.task, parent_task_id: s.parent_task_id }])),
    [data],
  );
  const t = data?.totals ?? {};
  const loaded = data && data.date === date;

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-4">
        <IconButton label="Previous day" onClick={onPrev}>
          <CaretLeft size={18} />
        </IconButton>
        <div className="text-center">
          <h2 className="text-lg font-semibold">{formatDayLabel(date)}</h2>
          {loaded && Number(data.hours_in_day) !== 24 && <p className="text-xs text-ink-soft">{data.hours_in_day}-hour day (clock change)</p>}
        </div>
        <IconButton label="Next day" onClick={onNext}>
          <CaretRight size={18} />
        </IconButton>
      </div>

      {!loaded && loading ? (
        <div className="py-16 text-center">
          <Spinner label="Loading day" />
        </div>
      ) : error ? (
        <p className="p-5 text-sm text-danger">{error}</p>
      ) : loaded ? (
        <div className="flex flex-col gap-5 p-5">
          {data.state === "outside_membership" && (
            <p className="rounded-[14px] bg-surface-alt px-3 py-2 text-sm text-ink-soft">No data available: this day is outside the membership dates.</p>
          )}
          {data.state === "no_recorded_work" && <p className="rounded-[14px] bg-surface-alt px-3 py-2 text-sm text-ink-soft">No recorded work on this day.</p>}
          {data.state === "future" && <p className="rounded-[14px] bg-surface-alt px-3 py-2 text-sm text-ink-soft">This day hasn&apos;t happened yet. Only deadlines are shown.</p>}

          {data.state !== "future" && data.state !== "outside_membership" && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Mini label="Closed attendance" value={formatDuration(t.closed_seconds)} tone="primary" />
                <Mini label="Live, not final" value={formatDuration(t.provisional_seconds)} tone={t.provisional_seconds > 0 ? "warning" : undefined} />
                <Mini label="On tasks" value={formatDuration(t.task_seconds)} />
                <Mini label="General activity" value={formatDuration(t.general_seconds)} />
                <Mini label="Unassigned" value={formatDuration(t.unassigned_seconds)} tone={t.unassigned_seconds > 0 ? "warning" : undefined} />
                <Mini
                  label="Timers outside attendance"
                  value={formatDuration(t.standalone_outside_attendance_seconds)}
                  hint={t.standalone_seconds > 0 ? `of ${formatDuration(t.standalone_seconds)} timers/manual` : undefined}
                />
              </div>

              {data.week.closed && (
                <div className="flex flex-col gap-1 rounded-[14px] border border-line px-3 py-2 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    <Lock size={16} className="text-ink-soft" /> This day is in a closed week (week of {formatDayLabel(data.week.week_start)})
                  </p>
                  <p className="tabular text-xs text-ink-soft">
                    Frozen: {formatDuration(data.week.regular_seconds)} regular, {formatDuration(data.week.overtime_seconds)} overtime. Corrections show as adjustments, never by changing the
                    closed week.
                  </p>
                  {data.week.adjustments_out.map((a: Json, i: number) => (
                    <p key={i} className="tabular text-xs">
                      Correction {formatDuration(a.regular_delta_seconds, { signed: true })} regular, {formatDuration(a.overtime_delta_seconds, { signed: true })} overtime → posted to{" "}
                      <Link href={`/time?week=${a.posted_week_start}`} className="font-medium text-primary-strong hover:underline">
                        week of {formatDayLabel(a.posted_week_start)}
                      </Link>
                    </p>
                  ))}
                </div>
              )}

              {segments.length > 0 && (
                <section className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Timeline</h3>
                    <TimelineLegend />
                  </div>
                  <Timeline segments={segments} tasksById={tasksById} from={Date.parse(data.starts_at)} to={Date.parse(data.ends_at)} now={now} />
                </section>
              )}

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Clock size={16} /> Attendance Sessions
                </h3>
                {data.sessions.length === 0 ? (
                  <p className="text-sm text-ink-soft">None.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {data.sessions.map((s: Json) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2">
                        <span className="tabular font-medium">
                          {formatTime(s.started_at)} – {s.open ? "open" : formatTime(s.ended_at)}
                        </span>
                        <span className="tabular text-xs text-ink-soft">{formatDuration(s.seconds)} this day</span>
                        {s.starts_previous_day && <Badge>from previous day</Badge>}
                        {s.continues_next_day && <Badge>continues next day</Badge>}
                        {s.open && <Badge tone="warning">Provisional</Badge>}
                        {s.origin === "manual" && <Badge tone="lavender">Added later</Badge>}
                        {s.corrected && <Badge tone="lavender">Corrected</Badge>}
                        {s.summary && <span className="w-full text-xs text-ink-soft">“{s.summary}”</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <ListChecks size={16} /> Tasks Worked On
                </h3>
                {data.tasks.length === 0 ? (
                  <p className="text-sm text-ink-soft">None.</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {data.tasks.map((x: Json) => (
                      <li key={x.id} className="rounded-[12px] border border-line px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link href={`/tasks/${x.id}`} className="min-w-0 font-medium hover:text-primary-strong">
                            {x.parent ? <span className="text-ink-soft">{x.parent} › </span> : null}
                            {x.title}
                          </Link>
                          <span className="tabular text-xs text-ink-soft">{x.seconds > 0 ? formatDuration(x.seconds) : "no tracked time"}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                          {x.progress.map((p: Json, i: number) => (
                            <Badge key={`p${i}`} tone="primary">
                              Progress {p.from ?? 0}% → {p.to}% at {formatTime(p.at)}
                            </Badge>
                          ))}
                          {x.deliverables.map((d: Json, i: number) => (
                            <Badge key={`d${i}`} tone="teal">
                              {d.summary}
                            </Badge>
                          ))}
                          {x.completions.map((c: Json, i: number) => (
                            <Badge key={`c${i}`} tone="success" icon={<CheckCircle size={12} />}>
                              {c.first ? "Completed" : "Completed again"} {formatTime(c.at)}
                            </Badge>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {data.entries.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Stack size={16} /> Timers and Manual Entries
                  </h3>
                  <ul className="flex flex-col gap-1 text-sm">
                    {data.entries.map((e: Json) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-2">
                        <Badge tone={e.source === "timer" ? "lavender" : "neutral"}>{e.source}</Badge>
                        <span className="tabular text-ink-soft">
                          {formatTime(e.from)}–{e.open ? "running" : formatTime(e.to)}
                        </span>
                        <Link href={`/tasks/${e.task_id}`} className="min-w-0 truncate hover:text-primary-strong">
                          {e.task}
                        </Link>
                        {e.overlap && <Badge tone="warning">overlap</Badge>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-ink-soft">Task time is for analysis only; it never counts toward payable hours.</p>
                </section>
              )}

              {data.events.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Note size={16} /> Other Events
                  </h3>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {data.events.map((e: Json) => (
                      <li key={e.id} className="flex gap-2">
                        <span className="tabular w-12 shrink-0 text-ink-soft">{formatTime(e.at)}</span>
                        <span className="min-w-0">
                          {e.task_id ? (
                            <Link href={`/tasks/${e.task_id}`} className="hover:text-primary-strong">
                              {e.summary}
                            </Link>
                          ) : (
                            e.summary
                          )}
                          {e.body && <span className="block text-xs text-ink-soft">“{e.body}”</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <section className="rounded-[14px] bg-surface-alt/70 p-3">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <FlagBanner size={16} /> Due on This Day
            </h3>
            {data.due.length === 0 ? (
              <p className="text-sm text-ink-soft">No deadlines.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {data.due.map((d: Json) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span className="tabular w-12 text-ink-soft">{formatTime(d.due_at)}</span>
                    <Link href={`/tasks/${d.id}`} className="min-w-0 truncate hover:text-primary-strong">
                      {d.title}
                    </Link>
                    <Badge tone={d.status === "completed" ? "success" : "neutral"}>{STATUS_LABEL[d.status as TaskStatus]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canCorrect && data.state !== "future" && data.state !== "outside_membership" && (
            <Link href={`/time?week=${data.week.week_start}`} className="text-sm font-medium text-primary-strong hover:underline">
              Correct attendance or re-label activity in Time →
            </Link>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function Mini({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "primary" | "warning" }) {
  return (
    <div className="rounded-[14px] border border-line px-3 py-2">
      <p className="text-[11px] text-ink-soft">{label}</p>
      <p className={clsx("tabular text-base font-semibold", tone === "primary" && "text-primary-strong", tone === "warning" && "text-warning")}>{value}</p>
      {hint && <p className="text-[11px] text-ink-soft">{hint}</p>}
    </div>
  );
}

