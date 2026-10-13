import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, expectCode, ids, resetDatabase, seed, type Actor } from "./harness";

// All past weeks below are in Cairo summer time (UTC+3). Weeks run Saturday → Friday.
const H = 3600;
const extra = {
  late: "bbbbbbbb-0000-4000-8000-000000000001", // joins Wed 2026-09-30
  weekend: "bbbbbbbb-0000-4000-8000-000000000002",
  fri: "bbbbbbbb-0000-4000-8000-000000000003", // joins Fri 2026-10-02
  forgot: "bbbbbbbb-0000-4000-8000-000000000004",
};

let admin: Client;
let admin2: Client;
let mgr: Actor;
let emp: Actor;
let empB: Actor;
let outsider: Actor;
let taskId: string;
let parentId: string;
let subId: string;

const t = (local: string) => `${local}:00+03:00`;

async function addEmployee(id: string, email: string, name: string, from: string) {
  await admin.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  await admin.query("insert into public.profiles (id, email, display_name) values ($1, $2, $3)", [id, email, name]);
  await admin.query("insert into public.workspace_members (workspace_id, user_id, role, active_from) values ($1, $2, 'employee', $3)", [ids.ws, id, from]);
}

async function addSession(actor: Actor, start: string, end: string, extraArgs: Record<string, unknown> = {}) {
  return actor.rpc<string>("add_attendance_session", { p_workspace: ids.ws, p_started_at: t(start), p_ended_at: t(end), p_reason: "Backfill for test", ...extraArgs });
}

async function summary(actor: Actor, user: string, week: string) {
  return actor.rpc<Record<string, unknown> & { adjustments_in: Array<Record<string, number | string>> }>("get_week_summary", {
    p_workspace: ids.ws,
    p_user: user,
    p_week_start: week,
  });
}

async function closeDue() {
  return (await admin.query("select app.close_due_weeks() as n")).rows[0].n as number;
}

async function adjustments(user: string) {
  return (await admin.query("select * from public.payroll_adjustments where user_id = $1 order by created_at", [user])).rows;
}

const currentWeek = async () => (await admin.query("select app.current_week_start($1) as w", [ids.ws])).rows[0].w as Date;
const iso = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  admin = await connect();
  admin2 = await connect();
  await resetDatabase(admin);
  await seed(admin);
  await addEmployee(extra.late, "late@example.com", "Late Joiner", "2026-09-30");
  await addEmployee(extra.weekend, "weekend@example.com", "Weekend Worker", "2026-01-01");
  await addEmployee(extra.fri, "fri@example.com", "Friday Joiner", "2026-10-02");
  await addEmployee(extra.forgot, "forgot@example.com", "Forgetful", "2026-01-01");
  mgr = as(admin, ids.manager);
  emp = as(admin, ids.employee);
  empB = as(admin2, ids.employee);
  outsider = as(admin, ids.outsiderEmployee);
  taskId = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Timed task", p_assignee: ids.employee, p_queue: "active" });
  parentId = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Parent project", p_assignee: ids.employee, p_queue: "active", p_work_type: "major_project" });
  subId = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Sub piece", p_parent: parentId });
});

afterAll(async () => {
  await admin?.end();
  await admin2?.end();
});

describe("A08 concurrent clock-in and switch", () => {
  it("two devices racing clock-in produce one open session; the loser gets a conflict", async () => {
    const results = await Promise.allSettled([emp.rpc("clock_in", { p_workspace: ids.ws }), empB.rpc("clock_in", { p_workspace: ids.ws })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("HZ409");
    const open = (await admin.query("select count(*)::int c from public.attendance_sessions where user_id=$1 and ended_at is null and voided_at is null", [ids.employee])).rows[0].c;
    expect(open).toBe(1);
  });

  it("two devices racing a switch from the same segment: one wins, one conflicts", async () => {
    const seg = (await admin.query("select id from public.live_activity_segments where user_id=$1 and ended_at is null and voided_at is null", [ids.employee])).rows[0].id;
    const results = await Promise.allSettled([
      emp.rpc("switch_activity", { p_workspace: ids.ws, p_expected_segment: seg, p_kind: "task", p_task: taskId }),
      empB.rpc("switch_activity", { p_workspace: ids.ws, p_expected_segment: seg, p_kind: "general", p_general_type: "Meeting" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.code).toBe("HZ409");
    const open = (await admin.query("select count(*)::int c from public.live_activity_segments where user_id=$1 and ended_at is null and voided_at is null", [ids.employee])).rows[0].c;
    expect(open).toBe(1);
  });

  it("switching warns about planned tasks and refuses completed ones", async () => {
    const planned = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Later", p_assignee: ids.employee });
    const r = await emp.rpc<{ warnings: string[] }>("switch_activity", { p_workspace: ids.ws, p_expected_segment: null, p_kind: "task", p_task: planned });
    expect(r.warnings.join(" ")).toMatch(/Planned/);
    const status = (await admin.query("select status from public.tasks where id=$1", [planned])).rows[0].status;
    expect(status).toBe("not_started");

    const done = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Done", p_assignee: ids.employee });
    await emp.rpc("complete_task", { p_task: done, p_expected_version: 1 });
    await expectCode(emp.rpc("switch_activity", { p_workspace: ids.ws, p_expected_segment: null, p_kind: "task", p_task: done }), "HZ423");
  });
});

describe("A09 clock-out", () => {
  it("closes the live segment at the same instant and leaves a standalone timer running", async () => {
    await emp.rpc("switch_activity", { p_workspace: ids.ws, p_expected_segment: null, p_kind: "task", p_task: taskId });
    await emp.rpc("start_task_timer", { p_task: taskId });
    await expectCode(emp.rpc("start_task_timer", { p_task: taskId }), "HZ409");
    await new Promise((r) => setTimeout(r, 20));
    const out = await emp.rpc<{ session_id: string; ended_at: string }>("clock_out", { p_workspace: ids.ws, p_summary: "Wrapped up" });
    const session = (await admin.query("select ended_at from public.attendance_sessions where id=$1", [out.session_id])).rows[0];
    const lastSeg = (await admin.query(
      "select ended_at from public.live_activity_segments where attendance_session_id=$1 and voided_at is null order by started_at desc limit 1",
      [out.session_id],
    )).rows[0];
    expect(new Date(lastSeg.ended_at).getTime()).toBe(new Date(session.ended_at).getTime());
    const openSeg = (await admin.query("select count(*)::int c from public.live_activity_segments where user_id=$1 and ended_at is null and voided_at is null", [ids.employee])).rows[0].c;
    expect(openSeg).toBe(0);
    const timer = (await admin.query("select ended_at from public.task_time_entries where user_id=$1 and source='timer' and voided_at is null", [ids.employee])).rows[0];
    expect(timer.ended_at).toBeNull();
    await emp.rpc("stop_task_timer", {});
  });
});

describe("A29 manager boundaries", () => {
  it("manager cannot clock in or correct the employee's attendance; can read it; outsiders can't", async () => {
    await expectCode(mgr.rpc("clock_in", { p_workspace: ids.ws }), "HZ403");
    const s = (await admin.query("select id, version from public.attendance_sessions where user_id=$1 limit 1", [ids.employee])).rows[0];
    await expectCode(mgr.rpc("correct_attendance", { p_session: s.id, p_expected_version: s.version, p_started_at: t("2026-09-01T09:00"), p_ended_at: t("2026-09-01T10:00"), p_reason: "nope" }), "HZ403");
    await expectCode(mgr.query("update public.attendance_sessions set ended_at = now() where id=$1", [s.id]), "42501");
    expect((await mgr.query("select id from public.attendance_sessions where user_id=$1", [ids.employee])).length).toBeGreaterThan(0);
    expect((await outsider.query("select id from public.attendance_sessions where user_id=$1", [ids.employee])).length).toBe(0);
  });
});

describe("Backfilled weeks, proration and close", () => {
  it("records backdated sessions and rejects overlaps", async () => {
    // Week Sat 2026-08-29 … Fri 09-04: 15h (under target)
    await addSession(emp, "2026-08-30T09:00", "2026-08-30T17:00");
    await addSession(emp, "2026-08-31T09:00", "2026-08-31T16:00");
    // Week 2026-09-05 … 09-11: 22h
    await addSession(emp, "2026-09-06T08:00", "2026-09-06T18:00");
    await addSession(emp, "2026-09-07T08:00", "2026-09-07T20:00");
    // Week 2026-09-12 … 09-18: exactly 20h
    await addSession(emp, "2026-09-13T09:00", "2026-09-13T19:00");
    await addSession(emp, "2026-09-14T09:00", "2026-09-14T19:00");
    // Week 2026-09-19 … 09-25: 27.5h, including 2h unassigned for A13
    await addSession(emp, "2026-09-20T09:00", "2026-09-20T19:00");
    await addSession(emp, "2026-09-21T09:00", "2026-09-21T19:00");
    await addSession(emp, "2026-09-22T09:00", "2026-09-22T11:00");
    await addSession(emp, "2026-09-23T09:00", "2026-09-23T14:30");
    // Cross-week: Fri 2026-10-02 23:00 → Sat 10-03 01:00
    await addSession(emp, "2026-10-02T23:00", "2026-10-03T01:00");
    await expectCode(addSession(emp, "2026-09-13T18:00", "2026-09-13T20:00"), "HZ422");
    await expectCode(addSession(mgr, "2026-09-13T21:00", "2026-09-13T22:00"), "HZ403");

    // A24: joins Wednesday 09-30 → Wed+Thu = 2 of 5 working days → 8h target; 10h worked
    await addSession(as(admin, extra.late), "2026-09-30T09:00", "2026-09-30T14:00");
    await addSession(as(admin, extra.late), "2026-10-01T09:00", "2026-10-01T14:00");
    await expectCode(addSession(as(admin, extra.late), "2026-09-29T09:00", "2026-09-29T10:00"), "HZ422");
    // A24b: Sun–Thu 16h + Saturday 6h in week 09-19
    await addSession(as(admin, extra.weekend), "2026-09-19T09:00", "2026-09-19T15:00");
    await addSession(as(admin, extra.weekend), "2026-09-20T09:00", "2026-09-20T17:00");
    await addSession(as(admin, extra.weekend), "2026-09-21T09:00", "2026-09-21T17:00");
    // A24c: joins Friday 10-02 → 0 working days in week 09-26
    await addSession(as(admin, extra.fri), "2026-10-02T10:00", "2026-10-02T13:00");
    // A10/A28: forgotten clock-out inside week 09-26, left open
    await admin.query(
      "insert into public.attendance_sessions (workspace_id, user_id, started_at, origin) values ($1, $2, $3, 'clock')",
      [ids.ws, extra.forgot, t("2026-09-28T09:00")],
    );
  });

  it("A13 unassigned time counts as attendance but not task time; re-labelling moves it", async () => {
    const seg = (await admin.query(
      "select id from public.live_activity_segments where user_id=$1 and started_at=$2 and voided_at is null",
      [ids.employee, t("2026-09-22T09:00")],
    )).rows[0].id;
    let tt = await emp.rpc<{ direct_unique_seconds: number }>("get_task_time", { p_task: taskId });
    const before = tt.direct_unique_seconds;
    await emp.rpc("reclassify_segment", { p_segment: seg, p_from: t("2026-09-22T10:00"), p_to: null, p_kind: "task", p_task: taskId, p_reason: "Was on the timed task" });
    tt = await emp.rpc("get_task_time", { p_task: taskId });
    expect(tt.direct_unique_seconds - before).toBe(H);
    const pieces = (await admin.query("select kind, started_at, ended_at from public.live_activity_segments where split_from=$1 order by started_at", [seg])).rows;
    expect(pieces.map((p) => p.kind)).toEqual(["unassigned", "task"]);
  });

  it("A25 weekly close is idempotent and freezes totals", async () => {
    const n1 = await closeDue();
    const n2 = await closeDue();
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(0);
    const dupes = (await admin.query("select count(*)::int c from (select user_id, week_start from public.week_closures group by 1,2 having count(*) > 1) x")).rows[0].c;
    expect(dupes).toBe(0);
    expect(await emp.rpc("close_my_due_weeks", { p_workspace: ids.ws })).toBe(0);
    await expectCode(admin.query("update public.week_closures set overtime_seconds = 0"), "HZ403");
  });

  it("A11 20h → 0 OT, 27.5h → 7.5 OT, overtime month by Friday, cross-midnight split", async () => {
    const exact = await summary(emp, ids.employee, "2026-09-12");
    expect([exact.closed_seconds, exact.regular_seconds, exact.overtime_seconds, exact.status]).toEqual([20 * H, 20 * H, 0, "closed"]);
    const busy = await summary(emp, ids.employee, "2026-09-19");
    expect([busy.closed_seconds, busy.regular_seconds, busy.overtime_seconds]).toEqual([27.5 * H, 20 * H, 7.5 * H]);
    expect(busy.payroll_month).toBe("2026-09");
    const cross = await summary(emp, ids.employee, "2026-09-26");
    const next = await summary(emp, ids.employee, "2026-10-03");
    expect(cross.closed_seconds).toBe(H);
    expect(next.closed_seconds).toBe(H);
    expect(cross.payroll_month).toBe("2026-10");
    const oct = await emp.rpc<{ net_overtime_seconds: number; weeks: unknown[] }>("get_month_overtime", { p_workspace: ids.ws, p_user: ids.employee, p_month: "2026-09-01" });
    expect(oct.weeks.map((w) => (w as { week_start: string }).week_start)).toEqual(["2026-08-29", "2026-09-05", "2026-09-12", "2026-09-19"]);
    expect(oct.net_overtime_seconds).toBe(2 * H + 7.5 * H);
  });

  it("A24 proration and weekend hours", async () => {
    const late = await summary(as(admin, extra.late), extra.late, "2026-09-26");
    expect([late.active_working_days, late.target_seconds, late.closed_seconds, late.overtime_seconds]).toEqual([2, 8 * H, 10 * H, 2 * H]);
    const weekend = await summary(as(admin, extra.weekend), extra.weekend, "2026-09-19");
    expect([weekend.target_seconds, weekend.closed_seconds, weekend.overtime_seconds]).toEqual([20 * H, 22 * H, 2 * H]);
    const fri = await summary(as(admin, extra.fri), extra.fri, "2026-09-26");
    expect([fri.active_working_days, fri.target_seconds, fri.overtime_seconds]).toEqual([0, 0, 3 * H]);
  });

  it("A10 a forgotten open session is excluded from the closed week", async () => {
    const s = await summary(as(admin, extra.forgot), extra.forgot, "2026-09-26");
    expect(s.closed_seconds).toBe(0);
    expect((s.closure as { excluded_open_session_ids: string[] }).excluded_open_session_ids).toHaveLength(1);
    expect(s.provisional_open_seconds as number).toBeGreaterThan(0);
  });

  it("A28 closing that session later posts its closed-week share as an adjustment", async () => {
    const forgot = as(admin, extra.forgot);
    const sess = (await admin.query("select id, version from public.attendance_sessions where user_id=$1", [extra.forgot])).rows[0];
    await forgot.rpc("correct_attendance", { p_session: sess.id, p_expected_version: sess.version, p_started_at: t("2026-09-28T09:00"), p_ended_at: t("2026-09-28T17:00"), p_reason: "Forgot to clock out" });
    const adj = await adjustments(extra.forgot);
    expect(adj).toHaveLength(1);
    expect(iso(adj[0].source_week_start)).toBe("2026-09-26");
    expect(iso(adj[0].posted_week_start)).toBe(iso(await currentWeek()));
    expect([adj[0].regular_delta_seconds, adj[0].overtime_delta_seconds]).toEqual([8 * H, 0]);
    const closed = (await admin.query("select closed_union_seconds from public.week_closures where user_id=$1 and week_start='2026-09-26'", [extra.forgot])).rows[0];
    expect(closed.closed_union_seconds).toBe(0);
    const segs = (await admin.query("select count(*)::int c from public.live_activity_segments where attendance_session_id=$1 and ended_at is null and voided_at is null", [sess.id])).rows[0].c;
    expect(segs).toBe(0);
  });

  it("A26 a 3h session added to a closed 22h week posts +3h overtime to the open week only", async () => {
    const before = (await admin.query("select * from public.week_closures where user_id=$1 and week_start='2026-09-05'", [ids.employee])).rows[0];
    expect([before.regular_seconds, before.overtime_seconds]).toEqual([20 * H, 2 * H]);
    const added = await addSession(emp, "2026-09-08T09:00", "2026-09-08T12:00");
    const after = (await admin.query("select * from public.week_closures where user_id=$1 and week_start='2026-09-05'", [ids.employee])).rows[0];
    expect(after).toEqual(before);
    const adj = (await adjustments(ids.employee)).filter((a) => iso(a.source_week_start) === "2026-09-05");
    expect(adj).toHaveLength(1);
    expect([adj[0].regular_delta_seconds, adj[0].overtime_delta_seconds]).toEqual([0, 3 * H]);
    const audit = (await admin.query("select event_type from public.audit_events where id=$1", [adj[0].cause_audit_event_id])).rows[0];
    expect(audit.event_type).toBe("attendance.session_added");
    const n = (await admin.query("select critical from public.notifications where recipient_id=$1 and event_type='payroll.adjustment_posted'", [ids.manager])).rows;
    expect(n.at(-1)!.critical).toBe(true);

    // A27: shortening it to 1h posts a negative correction
    const v = (await admin.query("select version from public.attendance_sessions where id=$1", [added])).rows[0].version;
    await emp.rpc("correct_attendance", { p_session: added, p_expected_version: v, p_started_at: t("2026-09-08T09:00"), p_ended_at: t("2026-09-08T10:00"), p_reason: "Ended earlier" });
    const all = (await adjustments(ids.employee)).filter((a) => iso(a.source_week_start) === "2026-09-05");
    expect(all.map((a) => a.overtime_delta_seconds)).toEqual([3 * H, -2 * H]);
    const open = await summary(emp, ids.employee, iso(await currentWeek()));
    expect(open.adjustments_in.length).toBeGreaterThanOrEqual(2);
  });

  it("A27 a week under target posts a regular-hours delta only", async () => {
    await addSession(emp, "2026-09-01T09:00", "2026-09-01T11:00");
    const adj = (await adjustments(ids.employee)).filter((a) => iso(a.source_week_start) === "2026-08-29");
    expect([adj[0].regular_delta_seconds, adj[0].overtime_delta_seconds]).toEqual([2 * H, 0]);
  });

  it("re-labelling activity in a closed week posts no adjustment", async () => {
    const count = (await adjustments(ids.employee)).length;
    const seg = (await admin.query(
      "select id from public.live_activity_segments where user_id=$1 and started_at=$2 and voided_at is null",
      [ids.employee, t("2026-09-13T09:00")],
    )).rows[0].id;
    await emp.rpc("reclassify_segment", { p_segment: seg, p_from: null, p_to: null, p_kind: "general", p_general_type: "Meeting", p_reason: "It was the planning meeting" });
    expect((await adjustments(ids.employee)).length).toBe(count);
  });
});

describe("A12 and A21 task time", () => {
  it("A12 overlapping manual entries need confirmation; raw and de-duplicated totals differ", async () => {
    const tid = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Overlap check", p_assignee: ids.employee });
    await emp.rpc("add_manual_time", { p_task: tid, p_started_at: t("2026-09-24T10:00"), p_ended_at: t("2026-09-24T12:00") });
    const err = await expectCode(emp.rpc("add_manual_time", { p_task: tid, p_started_at: t("2026-09-24T11:00"), p_ended_at: t("2026-09-24T13:00") }), "HZ422");
    expect(err.detail).toBe("overlap");
    await emp.rpc("add_manual_time", { p_task: tid, p_started_at: t("2026-09-24T11:00"), p_ended_at: t("2026-09-24T13:00"), p_acknowledge_overlap: true });
    const tt = await emp.rpc<{ direct_raw_seconds: number; direct_unique_seconds: number }>("get_task_time", { p_task: tid });
    expect([tt.direct_raw_seconds, tt.direct_unique_seconds]).toEqual([4 * H, 3 * H]);
  });

  it("A21 parent rollup counts subtask and parent time once", async () => {
    await emp.rpc("add_manual_time", { p_task: subId, p_started_at: t("2026-09-25T10:00"), p_ended_at: t("2026-09-25T11:00") });
    await emp.rpc("add_manual_time", { p_task: parentId, p_started_at: t("2026-09-25T10:30"), p_ended_at: t("2026-09-25T11:30"), p_acknowledge_overlap: true });
    const tt = await emp.rpc<Record<string, number>>("get_task_time", { p_task: parentId });
    expect([tt.direct_raw_seconds, tt.rollup_raw_seconds, tt.rollup_unique_seconds]).toEqual([H, 2 * H, 1.5 * H]);
  });
});

describe("Settings", () => {
  it("only the manager changes the target, never for past weeks", async () => {
    await expectCode(emp.rpc("set_weekly_target", { p_workspace: ids.ws, p_effective_from: "2026-12-05", p_minutes: 1500, p_working_days: [0, 1, 2, 3, 4] }), "HZ403");
    await expectCode(mgr.rpc("set_weekly_target", { p_workspace: ids.ws, p_effective_from: "2026-09-05", p_minutes: 1500, p_working_days: [0, 1, 2, 3, 4] }), "HZ422");
    await expectCode(mgr.rpc("set_weekly_target", { p_workspace: ids.ws, p_effective_from: "2026-12-06", p_minutes: 1500, p_working_days: [0, 1, 2, 3, 4] }), "HZ422");
    await mgr.rpc("set_weekly_target", { p_workspace: ids.ws, p_effective_from: "2026-12-05", p_minutes: 1500, p_working_days: [0, 1, 2, 3, 4] });
    const closed = (await admin.query("select target_seconds from public.week_closures where user_id=$1 and week_start='2026-09-12'", [ids.employee])).rows[0];
    expect(closed.target_seconds).toBe(20 * H);
  });
});
