import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, expectCode, ids, resetDatabase, seed, type Actor } from "./harness";

let admin: Client;
let emp: Actor;
let mgr: Actor;
let outsider: Actor;
let outsiderMgr: Actor;
const dst = "dddddddd-0000-4000-8000-000000000001";
const H = 3600;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows as Json[];

beforeAll(async () => {
  admin = await connect();
  await resetDatabase(admin);
  await seed(admin);
  emp = as(admin, ids.employee);
  mgr = as(admin, ids.manager);
  outsider = as(admin, ids.outsiderEmployee);
  outsiderMgr = as(admin, ids.outsiderManager);
  await admin.query("insert into auth.users (id, email) values ($1, 'dst2@example.com')", [dst]);
  await admin.query("insert into public.profiles (id, email, display_name) values ($1, 'dst2@example.com', 'DST Two')", [dst]);
  await admin.query("insert into public.workspace_members (workspace_id, user_id, role, active_from) values ($1, $2, 'employee', '2025-06-01')", [ids.ws, dst]);
});
afterAll(async () => {
  await admin?.end();
});

describe("A35 security pass", () => {
  it("row level security is on for every table in public", async () => {
    const off = await rows("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
    expect(off).toEqual([]);
  });

  it("anon can't read any table; signed-in users can't write any table directly", async () => {
    const anonRead = await rows(
      "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select')",
    );
    expect(anonRead).toEqual([]);
    const writes = await rows(
      `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
       and (has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
            or has_table_privilege('authenticated', c.oid, 'delete') or has_table_privilege('authenticated', c.oid, 'truncate'))`,
    );
    expect(writes).toEqual([]);
  });

  it("anon can call only the two secret-checked dispatcher functions", async () => {
    const fns = await rows(
      "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'execute') order by 1",
    );
    expect(fns.map((f) => f.proname)).toEqual(["email_claim", "email_report"]);
  });

  it("signed-in users can execute only the RLS helpers in the internal schema", async () => {
    const fns = await rows(
      "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and has_function_privilege('authenticated', p.oid, 'execute') order by 1",
    );
    expect(fns.map((f) => f.proname)).toEqual(["can_view_task", "can_view_user_work", "is_manager", "is_member"]);
    await expectCode(emp.query("select app.close_due_weeks()"), "42501");
    await expectCode(emp.query("select app.configure_email('https://x.example/api', repeat('a', 40))"), "42501");
  });

  it("every SECURITY DEFINER function pins its search_path", async () => {
    const bad = await rows(
      `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'app') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(bad).toEqual([]);
  });

  it("horizontal escalation: other people's records can't be read or changed through RPCs", async () => {
    await emp.rpc("add_attendance_session", { p_workspace: ids.ws, p_started_at: "2026-09-21T06:00:00Z", p_ended_at: "2026-09-21T08:00:00Z", p_reason: "Backfill" });
    const s = (await rows("select id, version from public.attendance_sessions where user_id = $1", [ids.employee]))[0]!;
    await expectCode(outsider.rpc("correct_attendance", { p_session: s.id, p_expected_version: s.version, p_started_at: "2026-09-21T06:00:00Z", p_ended_at: "2026-09-21T07:00:00Z", p_reason: "nope" }), "HZ404");
    await expectCode(outsider.rpc("void_attendance_session", { p_session: s.id, p_expected_version: s.version, p_reason: "nope" }), "HZ404");
    await expectCode(outsiderMgr.rpc("get_week_summary", { p_workspace: ids.ws, p_user: ids.employee, p_week_start: "2026-09-19" }), "HZ404");
    await expectCode(outsiderMgr.rpc("get_week_summary", { p_workspace: ids.otherWs, p_user: ids.employee, p_week_start: "2026-09-19" }), "HZ404");
    const t = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Private", p_assignee: ids.employee });
    await expectCode(outsider.rpc("get_task_time", { p_task: t }), "HZ404");
    await expectCode(outsider.rpc("start_task_timer", { p_task: t }), "HZ404");
    await expectCode(outsider.rpc("create_report", { p_workspace: ids.ws, p_kind: "task", p_task: t }), "HZ403");
    // A manager can't act as the employee.
    await expectCode(mgr.rpc("start_task_timer", { p_task: t }), "HZ403");
    await expectCode(mgr.rpc("set_progress", { p_task: t, p_expected_version: 1, p_progress: 50 }), "HZ403");
  });

  it("a client can't spoof its role through JWT claims to reach the dispatcher secret", async () => {
    const spoof = as(admin, ids.employee);
    await expectCode(spoof.rpc("email_claim", { p_secret: "guess", p_limit: 1 }), "HZ403");
    await expectCode(spoof.query("select value from app.email_config"), "42501");
  });
});

describe("A34 DST", () => {
  it("a week containing spring-forward is 167 hours and keeps sessions exact", async () => {
    const len = (await rows("select extract(epoch from upper(r) - lower(r))::int s from (select app.week_range($1, '2026-04-18') r) x", [ids.ws]))[0]!.s;
    expect(len).toBe(167 * H);
    await as(admin, dst).rpc("add_attendance_session", { p_workspace: ids.ws, p_started_at: "2026-04-23T20:00:00Z", p_ended_at: "2026-04-24T00:00:00Z", p_reason: "Across DST" });
    const w = await as(admin, dst).rpc<Json>("get_week_summary", { p_workspace: ids.ws, p_user: dst, p_week_start: "2026-04-18" });
    expect(w.current_closed_seconds).toBe(4 * H);
  });

  it("a week containing fall-back is 169 hours; a session in the repeated hour counts once", async () => {
    const len = (await rows("select extract(epoch from upper(r) - lower(r))::int s from (select app.week_range($1, '2025-10-25') r) x", [ids.ws]))[0]!.s;
    expect(len).toBe(169 * H);
    // 20:00Z–22:00Z on 30 Oct 2025 is local 23:00–23:00 twice (EEST then EET): two real hours.
    await as(admin, dst).rpc("add_attendance_session", { p_workspace: ids.ws, p_started_at: "2025-10-30T20:00:00Z", p_ended_at: "2025-10-30T22:00:00Z", p_reason: "Repeated hour" });
    const d = await as(admin, dst).rpc<Json>("get_day_summary", { p_workspace: ids.ws, p_user: dst, p_date: "2025-10-30" });
    expect(d.totals.closed_seconds).toBe(2 * H);
    expect(Number(d.hours_in_day)).toBe(25);
  });

  it("the weekly close boundary follows local Saturday midnight on both sides of DST", async () => {
    const summer = (await rows("select lower(app.week_range($1, '2026-04-25'))::text t", [ids.ws]))[0]!.t;
    const winter = (await rows("select lower(app.week_range($1, '2026-11-07'))::text t", [ids.ws]))[0]!.t;
    expect(summer).toBe("2026-04-24 21:00:00+00");
    expect(winter).toBe("2026-11-06 22:00:00+00");
  });
});
