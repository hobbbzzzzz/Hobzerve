import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, expectCode, ids, resetDatabase, seed, type Actor } from "./harness";

let admin: Client;
let emp: Actor;
let mgr: Actor;
let outsider: Actor;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const task = async (id: string) => (await admin.query("select * from public.tasks where id = $1", [id])).rows[0] as Json;

beforeAll(async () => {
  admin = await connect();
  await resetDatabase(admin);
  await seed(admin);
  emp = as(admin, ids.employee);
  mgr = as(admin, ids.manager);
  outsider = as(admin, ids.outsiderEmployee);
});
afterAll(async () => {
  await admin?.end();
});

describe("nicknames", () => {
  it("each person sets and clears only their own nickname", async () => {
    await emp.rpc("set_nickname", { p_nickname: "  Hobz " });
    await mgr.rpc("set_nickname", { p_nickname: "Dr. Badr" });
    const r = await admin.query("select id, nickname, display_name from public.profiles where id = any($1) order by id", [[ids.manager, ids.employee]]);
    expect(r.rows.map((x) => [x.nickname, x.display_name])).toEqual([
      ["Dr. Badr", "Ahmed Badr"],
      ["Hobz", "Abdelwahab Magdy"],
    ]);
    await emp.rpc("set_nickname", { p_nickname: "" });
    expect((await admin.query("select nickname from public.profiles where id = $1", [ids.employee])).rows[0].nickname).toBeNull();
  });

  it("rejects nicknames over 40 characters", async () => {
    await expectCode(emp.rpc("set_nickname", { p_nickname: "x".repeat(41) }), "23514");
  });
});

describe("projects", () => {
  let website: string;
  let mobile: string;

  it("both roles create projects; names are unique per workspace; colours come from the fixed set", async () => {
    website = await emp.rpc<string>("create_project", { p_workspace: ids.ws, p_name: "Website Revamp", p_color: "teal" });
    mobile = await mgr.rpc<string>("create_project", { p_workspace: ids.ws, p_name: "Mobile App", p_color: "pink" });
    await expectCode(mgr.rpc("create_project", { p_workspace: ids.ws, p_name: " website revamp " }), "HZ422");
    await expectCode(mgr.rpc("create_project", { p_workspace: ids.ws, p_name: "Neon", p_color: "neon" }), "23514");
    await expectCode(outsider.rpc("create_project", { p_workspace: ids.ws, p_name: "Sneaky" }), "HZ403");
    const seen = await emp.query<{ name: string }>("select name from public.projects order by sort_order");
    expect(seen.map((p) => p.name)).toEqual(["Website Revamp", "Mobile App"]);
    expect(await outsider.query("select id from public.projects")).toEqual([]);
  });

  it("signed-in users can't write the projects table directly", async () => {
    await expectCode(emp.query("insert into public.projects (workspace_id, name, created_by) values ($1, 'x', $2)", [ids.ws, ids.employee]), "42501");
  });

  it("a task can be created in a project, or as a general task; subtasks follow the parent", async () => {
    const t = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Landing page", p_project: website });
    const general = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Inbox zero" });
    const sub = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Hero copy", p_parent: t, p_project: mobile });
    expect((await task(t)).project_id).toBe(website);
    expect((await task(general)).project_id).toBeNull();
    expect((await task(sub)).project_id).toBe(website);
    await expectCode(emp.rpc("create_task", { p_workspace: ids.ws, p_title: "Bad", p_project: ids.catOps }), "HZ422");
  });

  it("moving a parent to another project moves its subtasks and records the change", async () => {
    const t = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Release", p_assignee: ids.employee, p_project: website });
    const sub = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Notes", p_parent: t });
    const v = (await task(t)).record_version;
    await emp.rpc("update_task", { p_task: t, p_expected_version: v, p_patch: { project_id: mobile } });
    expect((await task(t)).project_id).toBe(mobile);
    expect((await task(sub)).project_id).toBe(mobile);
    const audit = await admin.query("select summary, new_json from public.audit_events where task_id = $1 and event_type = 'task.updated'", [t]);
    expect(audit.rows[0].new_json).toEqual({ project_id: mobile });
    expect(audit.rows[0].summary).toContain("(project)");
    const sv = (await task(sub)).record_version;
    await expectCode(emp.rpc("update_task", { p_task: sub, p_expected_version: sv, p_patch: { project_id: website } }), "HZ422");
    await emp.rpc("update_task", { p_task: t, p_expected_version: v + 1, p_patch: { project_id: null } });
    expect((await task(sub)).project_id).toBeNull();
  });

  it("archived projects can't take new tasks; tasks already in them keep the link", async () => {
    const t = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Old work", p_project: website });
    await mgr.rpc("update_project", { p_project: website, p_name: "Website v2", p_color: "violet", p_archived: true });
    const p = (await admin.query("select name, color, archived_at from public.projects where id = $1", [website])).rows[0];
    expect([p.name, p.color, p.archived_at !== null]).toEqual(["Website v2", "violet", true]);
    expect((await task(t)).project_id).toBe(website);
    await expectCode(emp.rpc("create_task", { p_workspace: ids.ws, p_title: "New", p_project: website }), "HZ422");
    await emp.rpc("update_project", { p_project: website, p_archived: false });
    await emp.rpc("create_task", { p_workspace: ids.ws, p_title: "New", p_project: website });
  });

  it("analytics can be narrowed to one project or to general tasks", async () => {
    const r = await admin.query(
      `select app.task_matches(t, '{"project_id":"none"}') as general, app.task_matches(t, jsonb_build_object('project_id', $1::text)) as mobile
       from public.tasks t where title = 'Inbox zero'`,
      [mobile],
    );
    expect(r.rows[0]).toEqual({ general: true, mobile: false });
  });
});
