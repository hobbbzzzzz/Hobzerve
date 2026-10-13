"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { BarList, ChartCard, ColumnChart, LineChart, SERIES } from "@/components/charts";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, unwrap } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { addDays, cairoToday, formatDateTime, formatDayLabel, formatDuration, weekStartOf } from "@/lib/dates";
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, WORK_TYPE_LABEL } from "@/lib/labels";
import type { Category, TaskStatus, TaskWorkType } from "@/lib/types";
import { ArrowCounterClockwise, CalendarBlank, CheckCircle, Clock, FlagBanner, ListChecks, Sparkle, Stack, Warning } from "@/components/icons";
import { AnalyticsNav } from "./analytics-nav";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

type Preset = "this_month" | "last_month" | "this_week" | "last_week" | "custom";

export function periodFor(preset: Preset, from?: string | null, to?: string | null): { from: string; to: string } {
  const today = cairoToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const endOfMonth = (start: string) => addDays(`${new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7), 1)).toISOString().slice(0, 10)}`, -1);
  switch (preset) {
    case "last_month": {
      const lastEnd = addDays(monthStart, -1);
      return { from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd };
    }
    case "this_week":
      return { from: weekStartOf(today), to: addDays(weekStartOf(today), 6) };
    case "last_week":
      return { from: addDays(weekStartOf(today), -7), to: addDays(weekStartOf(today), -1) };
    case "custom":
      return { from: from ?? monthStart, to: to ?? today };
    default:
      return { from: monthStart, to: endOfMonth(monthStart) };
  }
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const monthShort = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${m}-15T12:00:00Z`));

export function AnalyticsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { workspace, userId, isManager, employees } = useWorkspace();
  const subject = isManager ? (params.get("user") ?? employees[0]?.user_id ?? null) : userId;
  const preset = (params.get("period") as Preset) || "this_month";
  const { from, to } = periodFor(preset, params.get("from"), params.get("to"));
  const filters = Object.fromEntries(["category_id", "work_type", "priority"].flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])));
  const [drill, setDrill] = useState<null | { title: string; body: ReactNode }>(null);

  const cats = useLoad(
    async () => unwrap(await getBrowserClient().from("categories").select("*").eq("workspace_id", workspace.id).order("sort_order").returns<Category[]>()) ?? [],
    [workspace.id],
  );
  const a = useLoad(async () => {
    if (!subject) return null;
    const { data, error } = await getBrowserClient().rpc("get_analytics", { p_workspace: workspace.id, p_user: subject, p_from: from, p_to: to, p_filters: filters });
    if (error) throw error;
    return data as Json;
  }, [workspace.id, subject, from, to, JSON.stringify(filters)]);

  function go(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  const k = a.data?.kpis;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-ink-soft">Separate measures, each with its rule — never a combined score. Click any figure to see what&apos;s behind it.</p>
        </div>
        <AnalyticsNav />
      </div>

      <div className="card flex flex-wrap items-end gap-2 p-3">
        {isManager && employees.length > 0 && (
          <Labeled label="Employee">
            <Select className="h-10 w-56" value={subject ?? ""} onChange={(e) => go({ user: e.target.value })}>
              {employees.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.profile.display_name}
                </option>
              ))}
            </Select>
          </Labeled>
        )}
        <Labeled label="Period">
          <Select className="h-10 w-44" value={preset} onChange={(e) => go({ period: e.target.value, from: e.target.value === "custom" ? from : null, to: e.target.value === "custom" ? to : null })}>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="this_week">This week</option>
            <option value="last_week">Last week</option>
            <option value="custom">Custom range</option>
          </Select>
        </Labeled>
        {preset === "custom" && (
          <>
            <Labeled label="From">
              <Input type="date" className="h-10 w-40" value={from} onChange={(e) => e.target.value && go({ from: e.target.value })} />
            </Labeled>
            <Labeled label="To">
              <Input type="date" className="h-10 w-40" value={to} onChange={(e) => e.target.value && go({ to: e.target.value })} />
            </Labeled>
          </>
        )}
        <Labeled label="Category">
          <Select className="h-10 w-44" value={filters.category_id ?? ""} onChange={(e) => go({ category_id: e.target.value || null })}>
            <option value="">All categories</option>
            {(cats.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Labeled>
        <Labeled label="Work type">
          <Select className="h-10 w-40" value={filters.work_type ?? ""} onChange={(e) => go({ work_type: e.target.value || null })}>
            <option value="">All types</option>
            {(Object.keys(WORK_TYPE_LABEL) as TaskWorkType[]).map((w) => (
              <option key={w} value={w}>
                {WORK_TYPE_LABEL[w]}
              </option>
            ))}
          </Select>
        </Labeled>
        <Labeled label="Priority">
          <Select className="h-10 w-36" value={filters.priority ?? ""} onChange={(e) => go({ priority: e.target.value || null })}>
            <option value="">Any</option>
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </Labeled>
        <p className="ml-auto self-center text-xs text-ink-soft">
          {formatDayLabel(from)} – {formatDayLabel(to)}
          {a.data && ` · as of ${formatDateTime(a.data.as_of)}`}
        </p>
      </div>

      {a.error && <p className="rounded-[14px] bg-danger-tint px-4 py-3 text-sm text-danger">{a.error}</p>}
      {!k && a.loading ? (
        <div className="py-16 text-center">
          <Spinner label="Calculating" />
        </div>
      ) : k ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Tile
              icon={<CheckCircle size={14} />}
              label="Completed"
              value={String(k.throughput.value)}
              hint={`${k.throughput.subtasks} subtasks counted separately`}
              onOpen={() => setDrill({ title: "Completed (first completions)", body: <Drill rule={k.throughput.rule} items={k.throughput.items} cols={throughputCols} /> })}
            />
            <Tile
              icon={<ListChecks size={14} />}
              label="Worked On"
              value={String(k.worked_on.value)}
              hint={`${k.worked_on.subtasks} subtasks counted separately`}
              onOpen={() => setDrill({ title: "Worked On", body: <Drill rule={k.worked_on.rule} items={k.worked_on.items} cols={[{ h: "Task", f: taskLink }, { h: "Category", f: (i) => i.category ?? "—" }]} /> })}
            />
            <Tile
              icon={<FlagBanner size={14} />}
              label="Due-Task Completion"
              value={pct(k.due_completion.value)}
              meter={k.due_completion.value}
              hint={`${k.due_completion.numerator} of ${k.due_completion.denominator} due · ${k.due_completion.not_yet_due} not yet due`}
              onOpen={() =>
                setDrill({
                  title: "Due-Task Completion",
                  body: (
                    <Drill
                      rule={k.due_completion.rule}
                      ratio={[k.due_completion.numerator, k.due_completion.denominator]}
                      extra={`${k.due_completion.cancelled} cancelled and ${k.due_completion.not_yet_due} not yet due are left out.`}
                      items={k.due_completion.items}
                      cols={[
                        { h: "Task", f: taskLink },
                        { h: "Due", f: (i) => formatDateTime(i.due_at) },
                        { h: "Completed", f: (i) => formatDateTime(i.completed_at) },
                        { h: "Counted", f: (i) => (i.eligible ? "Yes" : i.status === "cancelled" ? "No — cancelled" : "No — not yet due") },
                      ]}
                    />
                  ),
                })
              }
            />
            <Tile
              icon={<Stack size={14} />}
              label="Deliverables Fulfilled"
              value={pct(k.deliverable_fulfillment.value)}
              meter={k.deliverable_fulfillment.value}
              hint={`${k.deliverable_fulfillment.numerator} of ${k.deliverable_fulfillment.denominator} expected`}
              onOpen={() =>
                setDrill({
                  title: "Expected Deliverables Fulfilled",
                  body: (
                    <Drill
                      rule={k.deliverable_fulfillment.rule}
                      ratio={[k.deliverable_fulfillment.numerator, k.deliverable_fulfillment.denominator]}
                      items={k.deliverable_fulfillment.items}
                      cols={[
                        { h: "Task", f: taskLink },
                        { h: "Delivered", f: (i) => String(i.delivered) },
                        { h: "Applicable", f: (i) => String(i.applicable) },
                      ]}
                    />
                  ),
                })
              }
            />
            <Tile
              icon={<Sparkle size={14} />}
              label="Own Initiative"
              value={String(k.proactive.created)}
              hint={`${k.proactive.completed} completed · ${k.extras.self_initiated} self-initiated extras`}
              onOpen={() =>
                setDrill({
                  title: "Own Initiative and Extra Deliverables",
                  body: (
                    <>
                      <Drill rule={k.proactive.rule} items={k.proactive.items} cols={[{ h: "Task", f: taskLink }, { h: "Created", f: (i) => formatDateTime(i.created_at) }, { h: "Status", f: (i) => STATUS_LABEL[i.status as TaskStatus] }]} />
                      <h3 className="mt-5 mb-2 text-sm font-semibold">
                        Extra deliverables · {k.extras.self_initiated} self-initiated, {k.extras.manager_requested} manager-requested
                      </h3>
                      <Drill
                        rule={k.extras.rule}
                        items={k.extras.items}
                        cols={[
                          { h: "Deliverable", f: (i) => i.title },
                          { h: "Task", f: (i) => <Link href={`/tasks/${i.task_id}`} className="text-primary-strong hover:underline">{i.task}</Link> },
                          { h: "Initiated by", f: (i) => (i.origin === "self_initiated" ? "Employee" : "Manager") },
                        ]}
                      />
                    </>
                  ),
                })
              }
            />
          </div>

          <OnTimeCard k={k} onDrill={setDrill} />

          <div className="grid gap-3 md:grid-cols-3">
            <Tile
              icon={<Clock size={14} />}
              label="Overtime (Weeks Ending in Period)"
              value={formatDuration(k.attendance.overtime_seconds)}
              hint={k.attendance.final ? "All weeks closed" : "Includes provisional weeks"}
              onOpen={() => setDrill({ title: "Overtime by Week", body: <WeeksTable k={k} /> })}
            />
            <Tile
              icon={<Warning size={14} />}
              label="Unassigned Attendance"
              value={formatDuration(k.attendance.unassigned_seconds)}
              hint={`of ${formatDuration(k.attendance.closed_seconds)} closed attendance`}
              tone={k.attendance.unassigned_seconds > 0 ? "warning" : undefined}
            />
            <Tile
              icon={<ArrowCounterClockwise size={14} />}
              label="Reopened · Deadline Changes"
              value={`${k.reopens.revision + k.reopens.additional_scope} · ${k.deadline_changes.count}`}
              hint={`${k.reopens.revision} revision, ${k.reopens.additional_scope} additional scope`}
              onOpen={() =>
                setDrill({
                  title: "Reopens and Deadline Changes",
                  body: (
                    <>
                      <Drill
                        rule={k.reopens.rule}
                        items={k.reopens.items}
                        cols={[
                          { h: "Task", f: (i) => <Link href={`/tasks/${i.task_id}`} className="text-primary-strong hover:underline">{i.task}</Link> },
                          { h: "Kind", f: (i) => (i.mode === "revision" ? "Revision" : "Additional scope") },
                          { h: "Reason", f: (i) => i.reason },
                        ]}
                      />
                      <h3 className="mt-5 mb-2 text-sm font-semibold">Deadline Changes</h3>
                      <DeadlineTable items={k.deadline_changes.items} rule={k.deadline_changes.rule} />
                    </>
                  ),
                })
              }
            />
          </div>

          <WeeklyHours k={k} />

          <Trends trend={a.data.trend} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Breakdown title="By Category" rows={k.by_category} first={(r) => r.name} rule={k.breakdown_rule} />
            <Breakdown title="By Work Type" rows={k.by_work_type} first={(r) => WORK_TYPE_LABEL[r.work_type as TaskWorkType] ?? r.work_type} rule={k.breakdown_rule} />
          </div>

          {k.deadline_changes.items.length > 0 && (
            <Card>
              <CardHeader icon={<CalendarBlank size={20} />} title="Deadline Changes and Reasons" subtitle={`${k.deadline_changes.count} in this period`} />
              <div className="overflow-x-auto px-5 pb-5">
                <DeadlineTable items={k.deadline_changes.items} />
              </div>
            </Card>
          )}
        </>
      ) : null}

      <Dialog open={!!drill} onClose={() => setDrill(null)} title={drill?.title ?? ""} size="lg">
        {drill?.body}
      </Dialog>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
      {label}
      {children}
    </label>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
  onOpen,
  tone,
  meter,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  onOpen?: () => void;
  tone?: "warning";
  meter?: number | null;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs font-medium text-ink-soft">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary-gradient text-white" aria-hidden>
          {icon}
        </span>
        {label}
      </span>
      <span className={clsx("tabular text-3xl font-semibold", tone === "warning" ? "text-warning" : "text-ink")}>{value}</span>
      {meter != null && (
        <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt" aria-hidden>
          <span className="block h-full rounded-full bg-soft-gradient" style={{ width: `${Math.round(Math.min(1, Math.max(0, Number(meter))) * 100)}%` }} />
        </span>
      )}
      {hint && <span className="text-xs text-ink-soft">{hint}</span>}
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className="card card-accent flex flex-col items-start gap-1 p-4 text-left transition-shadow hover:shadow-[var(--shadow-lift)]">
      {body}
      <span className="mt-1 text-xs font-medium text-primary-strong">See Details</span>
    </button>
  ) : (
    <div className="card card-accent flex flex-col items-start gap-1 p-4">{body}</div>
  );
}

type Col = { h: string; f: (i: Json) => ReactNode };
const taskLink = (i: Json) => (
  <Link href={`/tasks/${i.id}`} className="text-primary-strong hover:underline">
    {i.title}
  </Link>
);
const throughputCols: Col[] = [
  { h: "Task", f: taskLink },
  { h: "First completed", f: (i) => formatDateTime(i.completed_at) },
  { h: "Calendar days", f: (i) => String(i.calendar_days ?? "—") },
  { h: "Tracked", f: (i) => formatDuration(i.effort_seconds ?? 0) },
];

function Drill({ rule, items, cols, ratio, extra }: { rule: string; items: Json[]; cols: Col[]; ratio?: [number, number]; extra?: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="rounded-[12px] bg-surface-alt px-3 py-2 text-ink-soft">
        <span className="font-medium text-ink">Rule: </span>
        {rule}
      </p>
      {ratio && (
        <p className="tabular">
          Numerator <span className="font-semibold">{ratio[0]}</span> · denominator <span className="font-semibold">{ratio[1]}</span>
          {ratio[1] > 0 && ` · ${Math.round((ratio[0] / ratio[1]) * 100)}%`}
        </p>
      )}
      {extra && <p className="text-ink-soft">{extra}</p>}
      {items.length === 0 ? (
        <p className="text-ink-soft">Nothing in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft">
                {cols.map((c) => (
                  <th key={c.h} className="pb-1.5 pr-3 font-medium">
                    {c.h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((i, n) => (
                <tr key={i.id ?? n} className="border-t border-line align-top">
                  {cols.map((c) => (
                    <td key={c.h} className="tabular py-1.5 pr-3">
                      {c.f(i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OnTimeCard({ k, onDrill }: { k: Json; onDrill: (d: { title: string; body: ReactNode }) => void }) {
  const at = k.on_time_at_completion;
  const re = k.on_time_restated;
  const cols: Col[] = [
    { h: "Task", f: taskLink },
    { h: "Completed", f: (i) => formatDateTime(i.completed_at) },
    { h: "Deadline", f: (i) => formatDateTime(i.due_at) },
    { h: "On time", f: (i) => (i.on_time ? "Yes" : "No") },
  ];
  return (
    <Card>
      <CardHeader icon={<CheckCircle size={20} />} title="On Time — Two Views, Always Shown Together" subtitle="Decision 108: the deadline is locked while a task is completed" />
      <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
        <button type="button" onClick={() => onDrill({ title: "On Time at Completion", body: <Drill rule={at.rule} ratio={[at.numerator, at.denominator]} items={at.items} cols={cols} /> })} className="flex flex-col items-start gap-1 rounded-[16px] border border-line p-4 text-left hover:bg-surface-alt">
          <span className="flex items-center gap-2 text-xs font-medium text-ink-soft">
            <span className="inline-block size-2.5 rounded-full" style={{ background: SERIES[0] }} aria-hidden />
            On Time at Completion
          </span>
          <span className="tabular text-3xl font-semibold">{pct(at.value)}</span>
          <span className="text-xs text-ink-soft">{at.denominator ? `${at.numerator} of ${at.denominator} with a deadline` : "No completed task had a deadline"} · never changes later</span>
        </button>
        <button type="button" onClick={() => onDrill({ title: "On time (restated)", body: <Drill rule={re.rule} ratio={[re.numerator, re.denominator]} items={re.items} cols={cols} /> })} className="flex flex-col items-start gap-1 rounded-[16px] border border-line p-4 text-left hover:bg-surface-alt">
          <span className="flex items-center gap-2 text-xs font-medium text-ink-soft">
            <span className="inline-block size-2.5 rounded-full" style={{ background: SERIES[1] }} aria-hidden />
            On Time (Restated)
            <Badge tone="warning">Restated</Badge>
          </span>
          <span className="tabular text-3xl font-semibold">{pct(re.value)}</span>
          <span className="text-xs text-ink-soft">{re.denominator ? `${re.numerator} of ${re.denominator}` : "No completed task had a deadline"} · uses the latest deadline</span>
        </button>
        {re.diverging.length > 0 && (
          <div className="md:col-span-2">
            <p className="mb-2 text-sm font-semibold">Where the two differ</p>
            <ul className="flex flex-col gap-2 text-sm">
              {re.diverging.map((d: Json) => (
                <li key={d.id} className="rounded-[12px] bg-surface-alt px-3 py-2">
                  <Link href={`/tasks/${d.id}`} className="font-medium text-primary-strong hover:underline">
                    {d.title}
                  </Link>
                  <span className="tabular block text-xs text-ink-soft">
                    Completed {formatDateTime(d.completed_at)} · due then {formatDateTime(d.due_at_completion)} · due now {formatDateTime(d.due_at_latest)}
                  </span>
                  {d.changes.map((c: Json, n: number) => (
                    <span key={n} className="block text-xs">
                      Changed by {c.by}: “{c.reason}”
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function Trends({ trend }: { trend: Json[] }) {
  const labels = trend.map((t) => monthShort(t.month));
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Last Six Months</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <ChartCard title="Completed Tasks" subtitle="First completions per month" table={{ headers: ["Month", "Completed", "Worked on"], rows: trend.map((t, i) => [labels[i]!, String(t.throughput), String(t.worked_on)]) }}>
          <ColumnChart ariaLabel="Completed tasks per month" points={trend.map((t, i) => ({ label: labels[i]!, value: t.throughput }))} format={(v) => String(Math.round(v))} />
        </ChartCard>
        <ChartCard
          title="On Time"
          subtitle="At completion vs restated, % of tasks with a deadline"
          legend={[
            { name: "At completion", color: SERIES[0] },
            { name: "Restated", color: SERIES[1] },
          ]}
          table={{ headers: ["Month", "At completion", "Restated"], rows: trend.map((t, i) => [labels[i]!, pct(t.on_time_at_completion), pct(t.on_time_restated)]) }}
        >
          <LineChart
            ariaLabel="On-time rate per month, at completion and restated"
            fixedMax={1}
            format={(v) => `${Math.round(v * 100)}%`}
            series={[
              { name: "At completion", points: trend.map((t, i) => ({ label: labels[i]!, value: t.on_time_at_completion == null ? null : Number(t.on_time_at_completion) })) },
              { name: "Restated", points: trend.map((t, i) => ({ label: labels[i]!, value: t.on_time_restated == null ? null : Number(t.on_time_restated) })) },
            ]}
          />
        </ChartCard>
        <ChartCard title="Overtime" subtitle="Hours, weeks counted in the month of their Friday" table={{ headers: ["Month", "Overtime", "Closed attendance"], rows: trend.map((t, i) => [labels[i]!, formatDuration(t.overtime_seconds), formatDuration(t.closed_seconds)]) }}>
          <ColumnChart ariaLabel="Overtime hours per month" points={trend.map((t, i) => ({ label: labels[i]!, value: t.overtime_seconds / 3600 }))} format={(v) => `${Math.round(v * 10) / 10}h`} />
        </ChartCard>
      </div>
    </section>
  );
}

function WeeklyHours({ k }: { k: Json }) {
  const weeks: Json[] = k.attendance.weeks;
  if (weeks.length === 0) return null;
  const label = (w: Json) => formatDayLabel(w.week_start).replace(/^\w+,?\s*/, "");
  const h = (sec: number) => sec / 3600;
  return (
    <ChartCard
      title="Hours by Week"
      subtitle="Closed attendance per Saturday–Friday week, against that week's prorated target"
      legend={[
        { name: "Closed hours", color: SERIES[0] },
        { name: "Target", color: "var(--color-ink)" },
      ]}
      table={{
        headers: ["Week of", "Closed", "Target", "Overtime"],
        rows: weeks.map((w) => [formatDayLabel(w.week_start), formatDuration(w.closed_seconds), formatDuration(w.target_seconds), formatDuration(w.overtime_seconds)]),
      }}
    >
      {/* Wide viewBox on desktop so the text keeps its size; the standard one on phones. */}
      {[960, undefined].map((width) => (
        <div key={width ?? "narrow"} className={width ? "hidden md:block" : "md:hidden"}>
          <ColumnChart
            ariaLabel="Closed attendance hours per week against the weekly target"
            points={weeks.map((w) => ({ label: label(w), value: h(w.closed_seconds) }))}
            reference={{ name: "Target", values: weeks.map((w) => h(w.target_seconds)) }}
            format={(v) => `${Math.round(v * 10) / 10}h`}
            width={width}
          />
        </div>
      ))}
    </ChartCard>
  );
}

function Breakdown({ title, rows, first, rule }: { title: string; rows: Json[]; first: (r: Json) => string; rule: string }) {
  return (
    <Card>
      <CardHeader icon={<Stack size={20} />} title={title} subtitle="Calendar days and tracked hours are kept separate" />
      <div className="overflow-x-auto px-5 pb-5">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-soft">No activity in this period.</p>
        ) : (
          <>
          <p className="mb-2 text-xs font-medium text-ink-soft">Tracked hours</p>
          <BarList
            ariaLabel={`Tracked hours ${title.toLowerCase()}`}
            rows={[...rows].sort((x, y) => y.tracked_seconds - x.tracked_seconds).map((r) => ({ label: first(r), value: r.tracked_seconds / 3600 }))}
            format={(v) => `${Math.round(v * 10) / 10}h`}
          />
          <table className="mt-5 w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft">
                <th className="pb-1.5 font-medium">Name</th>
                <th className="pb-1.5 text-right font-medium">Completed</th>
                <th className="pb-1.5 text-right font-medium">Worked on</th>
                <th className="pb-1.5 text-right font-medium">Avg calendar days</th>
                <th className="pb-1.5 text-right font-medium">Tracked</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((r) => (
                <tr key={first(r)} className="border-t border-line">
                  <td className="py-1.5">{first(r)}</td>
                  <td className="py-1.5 text-right">{r.throughput}</td>
                  <td className="py-1.5 text-right">{r.worked_on}</td>
                  <td className="py-1.5 text-right">{r.avg_calendar_days ?? "—"}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">{formatDuration(r.tracked_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
        <p className="mt-2 text-xs text-ink-soft">{rule}</p>
      </div>
    </Card>
  );
}

function WeeksTable({ k }: { k: Json }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="rounded-[12px] bg-surface-alt px-3 py-2 text-ink-soft">{k.attendance.rule}</p>
      <table className="w-full">
        <thead>
          <tr className="text-left text-xs text-ink-soft">
            <th className="pb-1.5 font-medium">Week of</th>
            <th className="pb-1.5 text-right font-medium">Target</th>
            <th className="pb-1.5 text-right font-medium">Closed</th>
            <th className="pb-1.5 text-right font-medium">Overtime</th>
            <th className="pb-1.5 text-right font-medium">Adjustments OT</th>
            <th className="pb-1.5 text-right font-medium">Net OT</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {k.attendance.weeks.map((w: Json) => (
            <tr key={w.week_start} className="border-t border-line">
              <td className="py-1.5">
                <Link href={`/time?week=${w.week_start}`} className="text-primary-strong hover:underline">
                  {formatDayLabel(w.week_start)}
                </Link>{" "}
                {!w.closed && <Badge tone="warning">provisional</Badge>}
              </td>
              <td className="py-1.5 text-right">{formatDuration(w.target_seconds)}</td>
              <td className="py-1.5 text-right">{formatDuration(w.closed_seconds)}</td>
              <td className="py-1.5 text-right">{formatDuration(w.overtime_seconds)}</td>
              <td className="py-1.5 text-right">{formatDuration(w.adjustment_overtime_seconds, { signed: true })}</td>
              <td className="py-1.5 text-right font-semibold">{formatDuration(w.net_overtime_seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {k.attendance.weeks.length === 0 && <p className="text-ink-soft">No week ends inside this period.</p>}
    </div>
  );
}

function DeadlineTable({ items, rule }: { items: Json[]; rule?: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {rule && <p className="text-ink-soft">{rule}</p>}
      {items.length === 0 ? (
        <p className="text-ink-soft">None.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-ink-soft">
              <th className="pb-1.5 pr-3 font-medium">Task</th>
              <th className="pb-1.5 pr-3 font-medium">From → to</th>
              <th className="pb-1.5 pr-3 font-medium">Reason</th>
              <th className="pb-1.5 font-medium">By</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c, n) => (
              <tr key={n} className="border-t border-line align-top">
                <td className="py-1.5 pr-3">
                  <Link href={`/tasks/${c.task_id}`} className="text-primary-strong hover:underline">
                    {c.task}
                  </Link>
                </td>
                <td className="tabular py-1.5 pr-3">
                  {formatDateTime(c.from)} → {formatDateTime(c.to)}
                </td>
                <td className="py-1.5 pr-3">“{c.reason}”</td>
                <td className="py-1.5">{c.by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
