import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, expectCode, ids, resetDatabase, seed, type Actor } from "./harness";

// Dates are computed from the database clock in Cairo time, so the suite works on any day and near midnight.
const H = 3600;
const dst = "cccccccc-0000-4000-8000-000000000001"; // employee with membership from 2025, for DST days

let admin: Client;
let mgr: Actor;
let emp: Actor;
let outsiderMgr: Actor;
let today: string;
let yesterday: string;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));
async function q1<T = Json>(sql: string, params: unknown[] = []): Promise<T> {
  return (await admin.query(sql, params)).rows[0] as T;
}
async function at(date: string, time: string): Promise<string> {
  return (await q1<{ t: Date }>("select app.local_ts($1, $2::date, $3::time) as t", [ids.ws, date, time])).t.toISOString();
}
async function shift(date: string, days: number): Promise<string> {
  return iso((await q1<{ d: Date }>("select ($1::date + $2::int) as d", [date, days])).d);
}
async function addSession(actor: Actor, date: string, from: string, toDate: string, to: string, extra: Json = {}) {
  return actor.rpc<string>("add_attendance_session", {
    p_workspace: ids.ws,
    p_started_at: await at(date, from),
    p_ended_at: await at(toDate, to),
    p_reason: "Recorded for test",
    ...extra,
  });
}
const day = (actor: Actor, user: string, date: string) => actor.rpc<Json>("get_day_summary", { p_workspace: ids.ws, p_user: user, p_date: date });
const month = (actor: Actor, user: string, date: string) => actor.rpc<Json>("get_month_calendar", { p_workspace: ids.ws, p_user: user, p_month: date });
const version = async (task: string) => (await q1<{ v: number }>("select record_version v from public.tasks where id=$1", [task])).v;

beforeAll(async () => {
  admin = await connect();
  await resetDatabase(admin);
  await seed(admin);
  await admin.query("insert into auth.users (id, email) values ($1, 'dst@example.com')", [dst]);
  await admin.query("insert into public.profiles (id, email, display_name) values ($1, 'dst@example.com', 'DST Tester')", [dst]);
  await admin.query("insert into public.workspace_members (workspace_id, user_id, role, active_from) values ($1, $2, 'employee', '2025-01-01')", [ids.ws, dst]);
  mgr = as(admin, ids.manager);
  emp = as(admin, ids.employee);
  outsiderMgr = as(admin, ids.outsiderManager);
  today = iso((await q1<{ d: Date }>("select app.local_date($1, now()) d", [ids.ws])).d);
  yesterday = await shift(today, -1);
});

afterAll(async () => {
  await admin?.end();
});

describe("Calendar (Decision 106)", () => {
  it("C01/A18 month grid and day detail for the employee's own days", async () => {
    await addSession(emp, yesterday, "09:00", yesterday, "12:00");
    const m = await month(emp, ids.employee, yesterday);
    expect(m.days).toHaveLength(42);
    expect(new Date(`${m.days[0].date}T12:00:00Z`).getUTCDay()).toBe(6);
    const cell = m.days.find((d: Json) => d.date === yesterday);
    expect(cell.closed_seconds).toBe(3 * H);
    expect(cell.unassigned_seconds).toBe(3 * H);
    const d = await day(emp, ids.employee, yesterday);
    expect(d.sessions).toHaveLength(1);
    expect(d.totals.closed_seconds).toBe(3 * H);
    expect(d.state).toBe("recorded");
  });

  it("C02 manager sees the linked employee; other workspaces don't", async () => {
    expect((await day(mgr, ids.employee, yesterday)).totals.closed_seconds).toBe(3 * H);
    await expectCode(day(outsiderMgr, ids.employee, yesterday), "HZ404");
    await expectCode(month(mgr, ids.outsiderEmployee, yesterday), "HZ404");
    await expectCode(month(emp, ids.manager, yesterday), "HZ404");
  });

  it("C03 a 23:30–00:30 session is split across two local dates", async () => {
    const before = await shift(yesterday, -1);
    await addSession(emp, before, "23:30", yesterday, "00:30");
    expect((await day(emp, ids.employee, before)).totals.closed_seconds).toBe(H / 2);
    const y = await day(emp, ids.employee, yesterday);
    expect(y.totals.closed_seconds).toBe(3 * H + H / 2);
    expect(y.sessions.some((s: Json) => s.starts_previous_day)).toBe(true);
  });

  it("C04 unassigned time is visible; C07 task time outside attendance is shown separately", async () => {
    const task = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Evening review", p_assignee: ids.employee, p_queue: "active" });
    await emp.rpc("add_manual_time", { p_task: task, p_started_at: await at(yesterday, "20:00"), p_ended_at: await at(yesterday, "21:00") });
    const d = await day(emp, ids.employee, yesterday);
    expect(d.totals.unassigned_seconds).toBe(3 * H + H / 2);
    expect(d.totals.standalone_seconds).toBe(H);
    expect(d.totals.standalone_outside_attendance_seconds).toBe(H);
    expect(d.totals.closed_seconds).toBe(3 * H + H / 2);
    expect(d.tasks.map((t: Json) => t.title)).toContain("Evening review");
  });

  it("C05 an open session is provisional", async () => {
    await emp.rpc("clock_in", { p_workspace: ids.ws });
    const d = await day(emp, ids.employee, today);
    const open = d.sessions.find((s: Json) => s.open);
    expect(open).toBeTruthy();
    expect(d.totals.closed_seconds).toBe(0);
    expect(d.totals.provisional_seconds).toBeGreaterThanOrEqual(0);
    await new Promise((r) => setTimeout(r, 20));
    await emp.rpc("clock_out", { p_workspace: ids.ws });
  });

  it("C06/A20 a progress-only update counts as worked on; a priority-only edit doesn't", async () => {
    const a = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Progress only", p_assignee: ids.employee });
    const b = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Priority only", p_assignee: ids.employee });
    const v = await emp.rpc<number>("change_task_status", { p_task: a, p_expected_version: await version(a), p_action: "start" });
    await emp.rpc<number>("set_progress", { p_task: a, p_expected_version: v, p_progress: 30 });
    await mgr.rpc("set_priority_level", { p_task: b, p_level: "urgent" });
    const d = await day(emp, ids.employee, today);
    const titles = d.tasks.map((t: Json) => t.title);
    expect(titles).toContain("Progress only");
    expect(titles).not.toContain("Priority only");
    const p = d.tasks.find((t: Json) => t.title === "Progress only");
    expect(p.progress[0].to).toBe(30);
    expect(d.events.some((e: Json) => e.type === "task.priority_changed" && e.task_id === b)).toBe(true);
  });

  it("C08 correcting a day in an open week updates the day and week totals", async () => {
    const s = await q1<{ id: string; version: number }>(
      "select id, version from public.attendance_sessions where user_id=$1 and started_at=$2",
      [ids.employee, await at(yesterday, "09:00")],
    );
    await emp.rpc("correct_attendance", {
      p_session: s.id, p_expected_version: s.version, p_started_at: await at(yesterday, "09:00"), p_ended_at: await at(yesterday, "13:00"), p_reason: "Left later",
    });
    const d = await day(emp, ids.employee, yesterday);
    expect(d.totals.closed_seconds).toBe(4 * H + H / 2);
    expect(d.sessions.find((x: Json) => x.id === s.id).corrected).toBe(true);
    // The correction event is listed on the day it was made (today), the session itself is flagged as corrected.
    expect((await day(emp, ids.employee, today)).events.some((e: Json) => e.type === "attendance.corrected")).toBe(true);
  });

  it("C09 a future day with a deadline shows due context but no work", async () => {
    const future = await shift(today, 5);
    await mgr.rpc("create_task", { p_workspace: ids.ws, p_title: "Due later", p_assignee: ids.employee, p_due_at: await at(future, "17:00") });
    const d = await day(emp, ids.employee, future);
    expect(d.state).toBe("future");
    expect(d.due.map((t: Json) => t.title)).toContain("Due later");
    expect(d.tasks).toEqual([]);
    expect(d.sessions).toEqual([]);
    const m = await month(emp, ids.employee, future);
    const cell = m.days.find((x: Json) => x.date === future);
    expect([cell.state, cell.due_count, cell.closed_seconds]).toEqual(["future", 1, 0]);
  });

  it("days before the membership start are 'outside membership', not 'no work'", async () => {
    const d = await day(emp, ids.employee, "2025-12-15");
    expect(d.state).toBe("outside_membership");
  });

  it("C11 correcting a day in a closed week changes the day view, not the frozen week, and shows the adjustment", async () => {
    await addSession(emp, "2026-09-14", "09:00", "2026-09-14", "17:00");
    await admin.query("select app.close_due_weeks()");
    const closedBefore = await q1("select regular_seconds, overtime_seconds from public.week_closures where user_id=$1 and week_start='2026-09-12'", [ids.employee]);
    const s = await q1<{ id: string; version: number }>(
      "select id, version from public.attendance_sessions where user_id=$1 and started_at=$2", [ids.employee, await at("2026-09-14", "09:00")],
    );
    await emp.rpc("correct_attendance", {
      p_session: s.id, p_expected_version: s.version, p_started_at: await at("2026-09-14", "09:00"), p_ended_at: await at("2026-09-14", "15:00"), p_reason: "Left at 3",
    });
    const d = await day(emp, ids.employee, "2026-09-14");
    expect(d.totals.closed_seconds).toBe(6 * H);
    expect(d.week.closed).toBe(true);
    expect(d.week.regular_seconds).toBe(closedBefore.regular_seconds);
    expect(d.week.adjustments_out).toHaveLength(1);
    expect(d.week.adjustments_out[0].regular_delta_seconds).toBe(-2 * H);
    const m = await month(emp, ids.employee, "2026-09-14");
    expect(m.days.find((x: Json) => x.date === "2026-09-14").week_corrected).toBe(true);
  });

  it("C12 DST days: 23-hour spring day and 25-hour autumn day keep exact totals", async () => {
    const dstEmp = as(admin, dst);
    // Spring forward: Friday 24 Apr 2026, 00:00 → 01:00.
    await dstEmp.rpc("add_attendance_session", {
      p_workspace: ids.ws, p_started_at: "2026-04-23T21:00:00Z", p_ended_at: "2026-04-23T23:00:00Z", p_reason: "DST spring",
    });
    const thu = await day(dstEmp, dst, "2026-04-23");
    const fri = await day(dstEmp, dst, "2026-04-24");
    expect([thu.totals.closed_seconds, fri.totals.closed_seconds]).toEqual([H, H]);
    expect(Number(fri.hours_in_day)).toBe(23);
    // Fall back: Thursday 30 Oct 2025 has 25 hours.
    await dstEmp.rpc("add_attendance_session", {
      p_workspace: ids.ws, p_started_at: "2025-10-30T19:00:00Z", p_ended_at: "2025-10-30T23:00:00Z", p_reason: "DST autumn",
    });
    const oct30 = await day(dstEmp, dst, "2025-10-30");
    const oct31 = await day(dstEmp, dst, "2025-10-31");
    expect(Number(oct30.hours_in_day)).toBe(25);
    expect([oct30.totals.closed_seconds, oct31.totals.closed_seconds]).toEqual([3 * H, H]);
    // That week was already closed (earlier catch-up), so the hours arrive as an adjustment; the recorded total is exact.
    const wk = await dstEmp.rpc<Json>("get_week_summary", { p_workspace: ids.ws, p_user: dst, p_week_start: "2025-10-25" });
    expect(wk.current_closed_seconds).toBe(4 * H);
  });
});

describe("Analytics (ANALYTICS_SPEC.md)", () => {
  let monthStart: string;
  let monthEnd: string;
  const kpis = async (actor: Actor = emp, filters: Json = {}) =>
    (await actor.rpc<Json>("get_analytics", { p_workspace: ids.ws, p_user: ids.employee, p_from: monthStart, p_to: monthEnd, p_filters: filters })).kpis;

  beforeAll(async () => {
    monthStart = iso((await q1<{ d: Date }>("select date_trunc('month', $1::date)::date d", [today])).d);
    monthEnd = iso((await q1<{ d: Date }>("select (date_trunc('month', $1::date) + interval '1 month - 1 day')::date d", [today])).d);
  });

  it("A30 on-time at completion stays on time; restated turns late after reopen + earlier deadline", async () => {
    const t = await mgr.rpc<string>("create_task", {
      p_workspace: ids.ws, p_title: "Dual metric", p_assignee: ids.employee, p_due_at: await at(await shift(today, 2), "17:00"),
    });
    await emp.rpc("complete_task", { p_task: t, p_expected_version: await version(t) });
    await emp.rpc("reopen_task", { p_task: t, p_expected_version: await version(t), p_mode: "revision", p_reason: "Fix typo" });
    await mgr.rpc("change_deadline", { p_task: t, p_expected_version: await version(t), p_due_at: await at(yesterday, "09:00"), p_reason: "Client moved the review earlier" });
    await emp.rpc("complete_task", { p_task: t, p_expected_version: await version(t) });

    const k = await kpis();
    const atC = k.on_time_at_completion.items.find((i: Json) => i.id === t);
    const re = k.on_time_restated.items.find((i: Json) => i.id === t);
    expect([atC.on_time, re.on_time]).toEqual([true, false]);
    const div = k.on_time_restated.diverging.find((i: Json) => i.id === t);
    expect(div.changes[0].reason).toBe("Client moved the review earlier");
    expect(k.throughput.items.filter((i: Json) => i.id === t)).toHaveLength(1);
    expect(k.reopens.revision).toBeGreaterThanOrEqual(1);
  });

  it("due-task completion excludes not-yet-due and cancelled tasks", async () => {
    const before = await kpis();
    const late = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Overdue", p_assignee: ids.employee, p_due_at: await at(today, "00:01") });
    const cancelled = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Dropped", p_assignee: ids.employee, p_due_at: await at(today, "00:01") });
    await emp.rpc("change_task_status", { p_task: cancelled, p_expected_version: await version(cancelled), p_action: "cancel", p_reason: "Out of scope" });
    const k = await kpis();
    expect(k.due_completion.denominator).toBe(before.due_completion.denominator + 1);
    expect(k.due_completion.cancelled).toBe(before.due_completion.cancelled + 1);
    expect(k.due_completion.items.find((i: Json) => i.id === late).eligible).toBe(true);
  });

  it("deliverable fulfillment uses the first-completion snapshot and skips Not applicable", async () => {
    const t = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Deliverables", p_assignee: ids.employee, p_expected_deliverables: ["A", "B", "C"] });
    const ds = (await admin.query("select id, title, version from public.deliverables where task_id=$1 order by title", [t])).rows;
    await emp.rpc("change_task_status", { p_task: t, p_expected_version: await version(t), p_action: "start" });
    await emp.rpc("set_deliverable_status", { p_deliverable: ds[0].id, p_expected_version: ds[0].version, p_status: "delivered" });
    await emp.rpc("set_deliverable_status", { p_deliverable: ds[1].id, p_expected_version: ds[1].version, p_status: "not_applicable" });
    await emp.rpc("complete_task", { p_task: t, p_expected_version: await version(t), p_missing_reasons: { [ds[2].id]: "Postponed" } });
    const item = (await kpis()).deliverable_fulfillment.items.find((i: Json) => i.id === t);
    expect([item.delivered, item.applicable]).toEqual([1, 2]);
  });

  it("proactive and extra-deliverable counts, category filter, and access control", async () => {
    const own = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "My idea", p_category: ids.catTech });
    await emp.rpc("add_deliverable", { p_task: own, p_kind: "extra", p_title: "Bonus" });
    const k = await kpis();
    expect(k.proactive.items.map((i: Json) => i.id)).toContain(own);
    expect(k.extras.self_initiated).toBeGreaterThanOrEqual(1);
    const tech = await kpis(emp, { category_id: ids.catTech });
    expect(tech.proactive.items.map((i: Json) => i.id)).toEqual([own]);
    expect(tech.throughput.value).toBe(0);
    expect(Array.isArray(k.by_category)).toBe(true);
    const full = await mgr.rpc<Json>("get_analytics", { p_workspace: ids.ws, p_user: ids.employee, p_from: monthStart, p_to: monthEnd });
    expect(full.trend).toHaveLength(6);
    await expectCode(outsiderMgr.rpc("get_analytics", { p_workspace: ids.ws, p_user: ids.employee, p_from: monthStart, p_to: monthEnd }), "HZ404");
  });
});

describe("Reports (Decisions 88–91, 111)", () => {
  it("A17 snapshots are immutable and flag changes after a correction", async () => {
    await addSession(emp, "2026-09-21", "09:00", "2026-09-21", "18:00");
    const id = await emp.rpc<string>("create_report", { p_workspace: ids.ws, p_kind: "weekly", p_from: "2026-09-23" });
    const r = await emp.rpc<Json>("get_report", { p_id: id });
    expect([r.period_start, r.period_end]).toEqual(["2026-09-19", "2026-09-25"]);
    expect(r.source_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // The week was closed before this session was added: frozen total stays, the correction shows as an adjustment.
    expect(r.source.week.current_closed_seconds).toBe(9 * H);
    expect(r.source.week.adjustments_out.length).toBeGreaterThan(0);
    await expectCode(admin.query("update public.report_snapshots set title='x' where id=$1", [id]), "HZ403");
    await expectCode(admin.query("delete from public.report_snapshots where id=$1", [id]), "HZ403");
    let ch = await emp.rpc<Json[]>("report_changes", { p_ids: [id] });
    expect(ch[0]!.changed).toBe(false);
    await addSession(emp, "2026-09-22", "09:00", "2026-09-22", "10:00");
    ch = await emp.rpc<Json[]>("report_changes", { p_ids: [id] });
    expect(ch[0]!.changed).toBe(true);
    const again = await emp.rpc<Json>("get_report", { p_id: id });
    expect(again.source_fingerprint).toBe(r.source_fingerprint);
  });

  it("task and project reports; access follows the subject", async () => {
    const parent = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Project X", p_assignee: ids.employee, p_work_type: "major_project" });
    const sub = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Piece 1", p_parent: parent });
    const pid = await mgr.rpc<string>("create_report", { p_workspace: ids.ws, p_kind: "project", p_task: parent });
    const p = await mgr.rpc<Json>("get_report", { p_id: pid });
    expect(p.source.task.subtasks.map((s: Json) => s.title)).toEqual(["Piece 1"]);
    expect(p.source.subtask_reports).toHaveLength(1);
    await expectCode(mgr.rpc("create_report", { p_workspace: ids.ws, p_kind: "project", p_task: sub }), "HZ422");
    await expectCode(outsiderMgr.rpc("get_report", { p_id: pid }), "HZ404");
    const daily = await emp.rpc<string>("create_report", { p_workspace: ids.ws, p_kind: "daily", p_from: yesterday });
    expect((await emp.rpc<Json>("get_report", { p_id: daily })).source.day.date).toBe(yesterday);
    await expectCode(emp.rpc("create_report", { p_workspace: ids.ws, p_kind: "daily", p_from: await shift(today, 3) }), "HZ422");
    await expectCode(emp.rpc("create_report", { p_workspace: ids.ws, p_kind: "monthly", p_user: ids.manager, p_from: today }), "HZ404");
  });

  it("A32 weekly reports generate automatically at close, monthly after the month's last week, once each", async () => {
    await admin.query("select app.close_due_weeks()");
    const weekly = (await admin.query("select period_start from public.report_snapshots where auto and kind='weekly' and subject_user_id=$1 order by period_start", [ids.employee])).rows;
    const closed = (await admin.query("select week_start from public.week_closures where user_id=$1 order by week_start", [ids.employee])).rows;
    expect(weekly.map((w) => iso(w.period_start))).toEqual(closed.map((c) => iso(c.week_start)));
    const monthly = (await admin.query("select period_start from public.report_snapshots where auto and kind='monthly' and subject_user_id=$1", [ids.employee])).rows;
    // September's last week (Friday 25 Sep) is closed, so its monthly report exists.
    expect(monthly.map((m) => iso(m.period_start))).toContain("2026-09-01");
    const before = (await admin.query("select count(*)::int c from public.report_snapshots where auto")).rows[0].c;
    await admin.query("select app.close_due_weeks()");
    expect((await admin.query("select count(*)::int c from public.report_snapshots where auto")).rows[0].c).toBe(before);
    const n = (await admin.query("select count(*)::int c from public.notifications where recipient_id=$1 and event_type='report.generated'", [ids.manager])).rows[0].c;
    expect(n).toBeGreaterThan(0);
  });
});
