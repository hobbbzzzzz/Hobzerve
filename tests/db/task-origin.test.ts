import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, expectCode, ids, resetDatabase, seed, type Actor } from "./harness";

let admin: Client;
let emp: Actor;
let mgr: Actor;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const task = async (id: string) => (await admin.query("select * from public.tasks where id = $1", [id])).rows[0] as Json;

beforeAll(async () => {
  admin = await connect();
  await resetDatabase(admin);
  await seed(admin);
  emp = as(admin, ids.employee);
  mgr = as(admin, ids.manager);
});
afterAll(async () => {
  await admin?.end();
});

describe("initiative or manager request", () => {
  it("the employee's tasks default to initiative and can be logged as a manager request", async () => {
    const own = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "My idea" });
    const asked = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Asked in the meeting", p_origin: "assigned" });
    expect((await task(own)).origin).toBe("employee_initiative");
    expect((await task(asked)).origin).toBe("assigned");
    expect((await task(asked)).creator_id).toBe(ids.employee);
    const n = await admin.query(
      "select n.title from public.notifications n join public.audit_events a on a.id = n.audit_event_id where a.task_id = $1 and n.recipient_id = $2",
      [asked, ids.manager],
    );
    expect(n.rows[0].title).toContain("the manager requested");
  });

  it("the manager's tasks are always manager requests", async () => {
    const t = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Do this", p_assignee: ids.employee });
    expect((await task(t)).origin).toBe("assigned");
    await expectCode(mgr.rpc("create_task", { p_workspace: ids.ws, p_title: "Fake", p_assignee: ids.employee, p_origin: "employee_initiative" }), "HZ422");
    await expectCode(emp.rpc("update_task", { p_task: t, p_expected_version: (await task(t)).record_version, p_patch: { origin: "employee_initiative" } }), "HZ422");
  });

  it("subtasks follow the parent, and correcting the parent corrects them, with history", async () => {
    const parent = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Report", p_origin: "assigned" });
    const sub = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Charts", p_parent: parent, p_origin: "employee_initiative" });
    expect((await task(sub)).origin).toBe("assigned");
    await expectCode(emp.rpc("update_task", { p_task: sub, p_expected_version: (await task(sub)).record_version, p_patch: { origin: "employee_initiative" } }), "HZ422");
    await mgr.rpc("update_task", { p_task: parent, p_expected_version: (await task(parent)).record_version, p_patch: { origin: "employee_initiative" } });
    expect((await task(parent)).origin).toBe("employee_initiative");
    expect((await task(sub)).origin).toBe("employee_initiative");
    const audit = await admin.query("select old_json, new_json from public.audit_events where task_id = $1 and event_type = 'task.updated'", [parent]);
    expect(audit.rows[0]).toEqual({ old_json: { origin: "assigned" }, new_json: { origin: "employee_initiative" } });
  });

  it("only initiatives count as own initiative in analytics", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await emp.rpc<Json>("get_analytics", { p_workspace: ids.ws, p_user: ids.employee, p_from: today, p_to: today });
    const titles = (r.kpis.proactive.items as Json[]).map((i) => i.title).sort();
    expect(titles).toEqual(["My idea", "Report"]);
  });
});
