import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, expectCode, ids, resetDatabase, seed, type Actor } from "./harness";

let admin: Client;
let mgr: Actor;
let emp: Actor;
let outsider: Actor;
let outsiderMgr: Actor;
let anon: Actor;

type TaskRow = {
  id: string;
  status: string;
  record_version: number;
  priority_rank: number | null;
  first_completed_at: string | null;
  current_due_at: string | null;
  queue: string;
  manual_progress: number;
};

async function task(id: string): Promise<TaskRow> {
  const r = await admin.query("select * from public.tasks where id = $1", [id]);
  return r.rows[0];
}

async function newTask(by: Actor, extra: Record<string, unknown> = {}): Promise<string> {
  const isManager = by === mgr;
  return by.rpc<string>("create_task", {
    p_workspace: ids.ws,
    p_title: (extra.p_title as string) ?? `Task ${Math.random().toString(36).slice(2, 7)}`,
    ...(isManager ? { p_assignee: ids.employee } : {}),
    ...extra,
  });
}

async function notificationsFor(userId: string, eventType?: string) {
  const r = await admin.query(
    `select * from public.notifications where recipient_id = $1 ${eventType ? "and event_type = $2" : ""} order by created_at`,
    eventType ? [userId, eventType] : [userId],
  );
  return r.rows;
}

beforeAll(async () => {
  admin = await connect();
  await resetDatabase(admin);
  await seed(admin);
  mgr = as(admin, ids.manager);
  emp = as(admin, ids.employee);
  outsider = as(admin, ids.outsiderEmployee);
  outsiderMgr = as(admin, ids.outsiderManager);
  anon = as(admin, null);
});

afterAll(async () => {
  await admin?.end();
});

describe("A01 access and tenancy", () => {
  it("members read their own workspace; outsiders and anon see nothing", async () => {
    const t = await newTask(mgr, { p_title: "Tenant check" });
    expect((await emp.query("select id from public.tasks where id = $1", [t])).length).toBe(1);
    expect((await mgr.query("select id from public.tasks where id = $1", [t])).length).toBe(1);
    expect((await outsider.query("select id from public.tasks where id = $1", [t])).length).toBe(0);
    expect((await outsiderMgr.query("select id from public.tasks where id = $1", [t])).length).toBe(0);
    expect((await outsider.query("select id from public.workspaces where id = $1", [ids.ws])).length).toBe(0);
    await expectCode(anon.query("select id from public.tasks"), "42501");
  });

  it("direct table writes are denied for authenticated users", async () => {
    const t = await newTask(mgr);
    await expectCode(emp.query("update public.tasks set manual_progress = 90 where id = $1", [t]), "42501");
    await expectCode(emp.query("insert into public.audit_events (workspace_id, entity_type, event_type, summary) values ($1,'x','x','x')", [ids.ws]), "42501");
    await expectCode(mgr.query("delete from public.tasks where id = $1", [t]), "42501");
  });

  it("outsiders cannot act on another workspace's tasks through RPCs", async () => {
    const t = await newTask(mgr);
    const v = (await task(t)).record_version;
    await expectCode(outsider.rpc("change_task_status", { p_task: t, p_expected_version: v, p_action: "start" }), "HZ404");
    await expectCode(outsiderMgr.rpc("change_deadline", { p_task: t, p_expected_version: v, p_due_at: "2026-11-01T10:00:00Z", p_reason: "nope" }), "HZ404");
    await expectCode(outsiderMgr.rpc("create_task", { p_workspace: ids.ws, p_title: "x", p_assignee: ids.employee }), "HZ403");
  });

  it("anon cannot execute RPCs", async () => {
    await expectCode(anon.rpc("create_task", { p_workspace: ids.ws, p_title: "x" }), "42501");
  });
});

describe("A02 ranking and priority", () => {
  it("manager reorders the active queue, employee is notified immediately, employee cannot reorder", async () => {
    const a = await newTask(mgr, { p_title: "Rank A", p_queue: "active" });
    const b = await newTask(mgr, { p_title: "Rank B", p_queue: "active" });
    const c = await newTask(mgr, { p_title: "Rank C", p_queue: "active" });
    const before = await admin.query(
      "select id from public.tasks where assignee_id=$1 and queue='active' and priority_rank is not null order by priority_rank",
      [ids.employee],
    );
    const order: string[] = before.rows.map((r) => r.id);
    expect(order.slice(-3)).toEqual([a, b, c]);
    const reordered = [c, ...order.filter((x) => x !== c)];

    await mgr.rpc("reorder_queue", { p_workspace: ids.ws, p_assignee: ids.employee, p_queue: "active", p_ordered: reordered });
    expect((await task(c)).priority_rank).toBe(1);
    const n = await notificationsFor(ids.employee, "queue.reordered");
    expect(n.length).toBeGreaterThan(0);
    expect(n.at(-1)!.critical).toBe(true);

    await expectCode(
      emp.rpc("reorder_queue", { p_workspace: ids.ws, p_assignee: ids.employee, p_queue: "active", p_ordered: reordered }),
      "HZ403",
    );
  });

  it("stale reorder is rejected as a conflict", async () => {
    await expectCode(
      mgr.rpc("reorder_queue", { p_workspace: ids.ws, p_assignee: ids.employee, p_queue: "active", p_ordered: [] }),
      "HZ409",
    );
  });

  it("only the manager sets priority level", async () => {
    const t = await newTask(mgr);
    await mgr.rpc("set_priority_level", { p_task: t, p_level: "urgent" });
    expect((await admin.query("select priority_level from public.tasks where id=$1", [t])).rows[0].priority_level).toBe("urgent");
    await expectCode(emp.rpc("set_priority_level", { p_task: t, p_level: "low" }), "HZ403");
    await expectCode(emp.rpc("create_task", { p_workspace: ids.ws, p_title: "Self", p_priority_level: "urgent" }), "HZ403");
  });
});

describe("A03 completion without verification", () => {
  it("requires reasons for undelivered expected deliverables, then completes immediately with audit + notification", async () => {
    const t = await newTask(mgr, { p_title: "Quarterly SOP", p_expected_deliverables: ["Draft", "Final PDF"] });
    let v = (await task(t)).record_version;
    v = await emp.rpc<number>("change_task_status", { p_task: t, p_expected_version: v, p_action: "start" });
    v = await emp.rpc<number>("set_progress", { p_task: t, p_expected_version: v, p_progress: 100 });

    const ds = (await admin.query("select id, title, version from public.deliverables where task_id=$1 order by title", [t])).rows;
    const draft = ds.find((d) => d.title === "Draft")!;
    const final = ds.find((d) => d.title === "Final PDF")!;
    await emp.rpc("set_deliverable_status", { p_deliverable: draft.id, p_expected_version: draft.version, p_status: "delivered" });

    const err = await expectCode(emp.rpc("complete_task", { p_task: t, p_expected_version: v }), "HZ422");
    expect(err.message).toMatch(/1 undelivered/);

    await expectCode(mgr.rpc("complete_task", { p_task: t, p_expected_version: v, p_missing_reasons: { [final.id]: "Client delayed" } }), "HZ403");

    await emp.rpc("complete_task", { p_task: t, p_expected_version: v, p_missing_reasons: { [final.id]: "Client delayed sign-off" } });
    const done = await task(t);
    expect(done.status).toBe("completed");
    expect(done.first_completed_at).not.toBeNull();
    expect(done.priority_rank).toBeNull();

    const ev = (await admin.query("select * from public.task_completion_events where task_id=$1", [t])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].is_first_completion).toBe(true);
    expect(Object.keys(ev[0].missing_deliverable_reasons)).toEqual([final.id]);

    const n = await notificationsFor(ids.manager, "task.completed");
    expect(n.some((x) => x.link === `/tasks/${t}`)).toBe(true);
    const audit = (await admin.query("select count(*)::int as c from public.audit_events where task_id=$1 and event_type='task.completed'", [t])).rows[0].c;
    expect(audit).toBe(1);
  });
});

describe("A04 revision requests", () => {
  it("manager request does not reopen; employee reopen keeps first completion counted once", async () => {
    const t = await newTask(mgr, { p_title: "Revision flow" });
    let v = (await task(t)).record_version;
    v = await emp.rpc<number>("change_task_status", { p_task: t, p_expected_version: v, p_action: "start" });
    await emp.rpc("complete_task", { p_task: t, p_expected_version: v });
    const first = (await task(t)).first_completed_at;

    await mgr.rpc("request_task_action", { p_task: t, p_kind: "revision", p_note: "Please fix the totals" });
    expect((await task(t)).status).toBe("completed");
    const req = await notificationsFor(ids.employee, "request.revision");
    expect(req.at(-1)!.critical).toBe(true);

    await expectCode(mgr.rpc("reopen_task", { p_task: t, p_expected_version: (await task(t)).record_version, p_mode: "revision", p_reason: "x y z" }), "HZ403");

    v = (await task(t)).record_version;
    v = await emp.rpc<number>("reopen_task", { p_task: t, p_expected_version: v, p_mode: "revision", p_reason: "Manager asked to fix totals" });
    expect((await task(t)).status).toBe("in_progress");
    await emp.rpc("complete_task", { p_task: t, p_expected_version: v });

    const after = await task(t);
    expect(after.first_completed_at).toEqual(first);
    const ev = (await admin.query("select is_first_completion from public.task_completion_events where task_id=$1 order by completed_at", [t])).rows;
    expect(ev.map((e) => e.is_first_completion)).toEqual([true, false]);
    const rounds = (await admin.query("select closed_at from public.revision_rounds where task_id=$1", [t])).rows;
    expect(rounds).toHaveLength(1);
    expect(rounds[0].closed_at).not.toBeNull();
  });

  it("additional scope opens a new cycle", async () => {
    const t = await newTask(emp, { p_title: "Scope cycle" });
    let v = (await task(t)).record_version;
    v = await emp.rpc<number>("complete_task", { p_task: t, p_expected_version: v }).then(async () => (await task(t)).record_version);
    await emp.rpc("reopen_task", { p_task: t, p_expected_version: v, p_mode: "additional_scope", p_reason: "Phase 2 requested" });
    const cycles = (await admin.query("select sequence, type, closed_at from public.scope_cycles where task_id=$1 order by sequence", [t])).rows;
    expect(cycles.map((c) => c.type)).toEqual(["original", "additional"]);
    expect(cycles[0].closed_at).not.toBeNull();
  });
});

describe("A05 parent completed with open subtasks (Decision 105)", () => {
  it("requires subtask reasons, then blocks subtask work until the parent is reopened", async () => {
    const parent = await newTask(mgr, { p_title: "Parent", p_work_type: "major_project" });
    const sub = await newTask(emp, { p_title: "Sub 1", p_parent: parent });
    let pv = (await task(parent)).record_version;
    pv = await emp.rpc<number>("change_task_status", { p_task: parent, p_expected_version: pv, p_action: "start" });

    await expectCode(emp.rpc("complete_task", { p_task: parent, p_expected_version: pv }), "HZ422");
    await emp.rpc("complete_task", { p_task: parent, p_expected_version: pv, p_subtask_reasons: { [sub]: "Moved to next sprint" } });

    const sv = (await task(sub)).record_version;
    await expectCode(emp.rpc("change_task_status", { p_task: sub, p_expected_version: sv, p_action: "start" }), "HZ423");
    await expectCode(emp.rpc("create_task", { p_workspace: ids.ws, p_title: "Sub 2", p_parent: parent }), "HZ423");

    pv = (await task(parent)).record_version;
    await emp.rpc("reopen_task", { p_task: parent, p_expected_version: pv, p_mode: "additional_scope", p_reason: "Finish remaining subtask" });
    await emp.rpc("change_task_status", { p_task: sub, p_expected_version: sv, p_action: "start" });
    expect((await task(sub)).status).toBe("in_progress");
  });

  it("subtasks are one level deep and never ranked", async () => {
    const parent = await newTask(mgr, { p_title: "P" });
    const sub = await newTask(emp, { p_title: "S", p_parent: parent });
    expect((await task(sub)).priority_rank).toBeNull();
    await expectCode(emp.rpc("create_task", { p_workspace: ids.ws, p_title: "SS", p_parent: sub }), "HZ422");
  });
});

describe("A06 scope change during work", () => {
  it("manager-added expected deliverable notifies the employee and leaves prior completion snapshots untouched", async () => {
    const t = await newTask(mgr, { p_title: "Snapshot", p_expected_deliverables: ["Report"] });
    let v = (await task(t)).record_version;
    v = await emp.rpc<number>("change_task_status", { p_task: t, p_expected_version: v, p_action: "start" });
    const rep = (await admin.query("select id, version from public.deliverables where task_id=$1", [t])).rows[0];
    await emp.rpc("set_deliverable_status", { p_deliverable: rep.id, p_expected_version: rep.version, p_status: "delivered" });
    await emp.rpc("complete_task", { p_task: t, p_expected_version: v });
    const snapBefore = (await admin.query("select deliverable_snapshot from public.task_completion_events where task_id=$1", [t])).rows[0].deliverable_snapshot;

    await expectCode(mgr.rpc("add_deliverable", { p_task: t, p_kind: "expected", p_title: "Appendix" }), "HZ423");

    v = (await task(t)).record_version;
    await emp.rpc("reopen_task", { p_task: t, p_expected_version: v, p_mode: "additional_scope", p_reason: "Appendix requested" });
    await mgr.rpc("add_deliverable", { p_task: t, p_kind: "expected", p_title: "Appendix" });

    const n = await notificationsFor(ids.employee, "scope.changed");
    expect(n.at(-1)!.title).toMatch(/Appendix/);
    const snapAfter = (await admin.query("select deliverable_snapshot from public.task_completion_events where task_id=$1 and is_first_completion", [t])).rows[0].deliverable_snapshot;
    expect(snapAfter).toEqual(snapBefore);
    await expectCode(admin.query("update public.task_completion_events set note='x' where task_id=$1", [t]), "HZ403");
  });

  it("extra deliverables record who initiated them", async () => {
    const t = await newTask(mgr);
    await emp.rpc("add_deliverable", { p_task: t, p_kind: "extra", p_title: "Bonus dashboard" });
    await mgr.rpc("add_deliverable", { p_task: t, p_kind: "extra", p_title: "Extra slide" });
    const rows = (await admin.query("select title, origin from public.deliverables where task_id=$1 order by title", [t])).rows;
    expect(rows).toEqual([
      { title: "Bonus dashboard", origin: "self_initiated" },
      { title: "Extra slide", origin: "manager_requested" },
    ]);
  });
});

describe("A07 deadline changes", () => {
  it("records every change with reason, actor and notification", async () => {
    const t = await newTask(mgr, { p_title: "Deadlines", p_due_at: "2026-10-20T20:59:00Z" });
    let v = (await task(t)).record_version;
    await expectCode(mgr.rpc("change_deadline", { p_task: t, p_expected_version: v, p_due_at: "2026-10-22T20:59:00Z", p_reason: "" }), "HZ422");
    v = await mgr.rpc<number>("change_deadline", { p_task: t, p_expected_version: v, p_due_at: "2026-10-22T20:59:00Z", p_reason: "Client moved review" });
    v = await emp.rpc<number>("change_deadline", { p_task: t, p_expected_version: v, p_due_at: "2026-10-25T20:59:00Z", p_reason: "Dependency slipped" });
    const rows = (await admin.query("select actor_id, reason from public.deadline_changes where task_id=$1 order by changed_at", [t])).rows;
    expect(rows.map((r) => r.actor_id)).toEqual([ids.manager, ids.employee]);
    const tk = await admin.query("select original_due_at, current_due_at from public.tasks where id=$1", [t]);
    expect(new Date(tk.rows[0].original_due_at).toISOString()).toBe("2026-10-20T20:59:00.000Z");
    expect(new Date(tk.rows[0].current_due_at).toISOString()).toBe("2026-10-25T20:59:00.000Z");
    expect((await notificationsFor(ids.employee, "task.deadline_changed")).length).toBeGreaterThan(0);
    expect((await notificationsFor(ids.manager, "task.deadline_changed")).length).toBeGreaterThan(0);
  });
});

describe("A23 deadline lock (Decision 108)", () => {
  it("blocks RPC and direct updates while completed, allows after reopen", async () => {
    const t = await newTask(mgr, { p_title: "Lock", p_due_at: "2026-10-20T20:59:00Z" });
    let v = (await task(t)).record_version;
    await emp.rpc("complete_task", { p_task: t, p_expected_version: v });
    v = (await task(t)).record_version;

    await expectCode(mgr.rpc("change_deadline", { p_task: t, p_expected_version: v, p_due_at: "2026-10-30T20:59:00Z", p_reason: "Make it on time" }), "HZ423");
    await expectCode(emp.rpc("change_deadline", { p_task: t, p_expected_version: v, p_due_at: "2026-10-30T20:59:00Z", p_reason: "Make it on time" }), "HZ423");
    await expectCode(admin.query("update public.tasks set current_due_at = now() where id=$1", [t]), "HZ423");

    v = await emp.rpc<number>("reopen_task", { p_task: t, p_expected_version: v, p_mode: "revision", p_reason: "Fixing a typo" });
    await mgr.rpc("change_deadline", { p_task: t, p_expected_version: v, p_due_at: "2026-10-30T20:59:00Z", p_reason: "New review date" });
    const due = (await admin.query("select due_at_at_completion from public.task_completion_events where task_id=$1", [t])).rows[0].due_at_at_completion;
    expect(new Date(due).toISOString()).toBe("2026-10-20T20:59:00.000Z");
  });
});

describe("A14 recurring instances", () => {
  it("generates one instance per template and date, idempotently, without notifications", async () => {
    const tpl = await mgr.rpc<string>("save_recurrence_template", {
      p_workspace: ids.ws,
      p_title: "Daily inbox triage",
      p_assignee: ids.employee,
      p_frequency: "daily",
      p_days_of_week: [0, 1, 2, 3, 4],
      p_expected_deliverables: ["Inbox zero"],
      p_due_local_time: "17:00",
      p_starts_on: "2026-10-01",
    });
    const before = (await notificationsFor(ids.employee)).length;
    // 2026-10-12 is a Monday (dow 1) in Cairo
    const n1 = (await admin.query("select app.generate_recurring_instances($1, '2026-10-12') as n", [ids.ws])).rows[0].n;
    const n2 = (await admin.query("select app.generate_recurring_instances($1, '2026-10-12') as n", [ids.ws])).rows[0].n;
    const fri = (await admin.query("select app.generate_recurring_instances($1, '2026-10-16') as n", [ids.ws])).rows[0].n;
    expect([n1, n2, fri]).toEqual([1, 0, 0]);

    const inst = (await admin.query("select * from public.tasks where recurrence_template_id=$1", [tpl])).rows;
    expect(inst).toHaveLength(1);
    expect(inst[0].queue).toBe("planned");
    expect(inst[0].work_type).toBe("routine");
    // 17:00 Cairo on 2026-10-12 (EEST, UTC+3) = 14:00 UTC
    expect(new Date(inst[0].current_due_at).toISOString()).toBe("2026-10-12T14:00:00.000Z");
    expect((await admin.query("select count(*)::int c from public.deliverables where task_id=$1", [inst[0].id])).rows[0].c).toBe(1);
    expect((await notificationsFor(ids.employee)).length).toBe(before);

    const viaRpc = await emp.rpc<number>("generate_my_recurring_instances", { p_workspace: ids.ws });
    expect(viaRpc).toBeGreaterThanOrEqual(0);
  });
});

describe("A15 notifications", () => {
  it("actor never gets a self-notification; mark all read works only on own notifications", async () => {
    const t = await newTask(emp, { p_title: "Self notif" });
    const own = (await admin.query("select count(*)::int c from public.notifications n join public.audit_events a on a.id = n.audit_event_id where a.task_id=$1 and n.recipient_id=$2", [t, ids.employee])).rows[0].c;
    expect(own).toBe(0);

    const unreadBefore = (await mgr.query<{ c: number }>("select count(*)::int c from public.notifications where read_at is null"))[0]!.c;
    expect(unreadBefore).toBeGreaterThan(0);
    const empUnread = (await emp.query<{ c: number }>("select count(*)::int c from public.notifications where read_at is null"))[0]!.c;
    await mgr.rpc("mark_notifications_read", {});
    expect((await mgr.query<{ c: number }>("select count(*)::int c from public.notifications where read_at is null"))[0]!.c).toBe(0);
    expect((await emp.query<{ c: number }>("select count(*)::int c from public.notifications where read_at is null"))[0]!.c).toBe(empUnread);
  });

  it("muted non-critical events are audited but not notified; critical ones still arrive", async () => {
    await mgr.rpc("set_notification_mutes", { p_event_types: ["task.progress_updated", "task.deadline_changed"] });
    const t = await newTask(mgr, { p_title: "Mute test" });
    let v = (await task(t)).record_version;
    v = await emp.rpc<number>("change_task_status", { p_task: t, p_expected_version: v, p_action: "start" });
    v = await emp.rpc<number>("set_progress", { p_task: t, p_expected_version: v, p_progress: 40 });
    await emp.rpc("change_deadline", { p_task: t, p_expected_version: v, p_due_at: "2026-12-01T10:00:00Z", p_reason: "Need more time" });
    const forTask = (await admin.query(
      "select n.event_type from public.notifications n join public.audit_events a on a.id=n.audit_event_id where a.task_id=$1 and n.recipient_id=$2",
      [t, ids.manager],
    )).rows.map((r) => r.event_type);
    expect(forTask).not.toContain("task.progress_updated");
    expect(forTask).toContain("task.deadline_changed");
    const audited = (await admin.query("select count(*)::int c from public.audit_events where task_id=$1 and event_type='task.progress_updated'", [t])).rows[0].c;
    expect(audited).toBe(1);
    await mgr.rpc("set_notification_mutes", { p_event_types: [] });
  });
});

describe("Operational rules", () => {
  it("only the employee changes progress and lifecycle; hold needs a reason and freezes progress", async () => {
    const t = await newTask(mgr, { p_title: "Ops" });
    let v = (await task(t)).record_version;
    await expectCode(mgr.rpc("change_task_status", { p_task: t, p_expected_version: v, p_action: "start" }), "HZ403");
    await expectCode(emp.rpc("set_progress", { p_task: t, p_expected_version: v, p_progress: 10 }), "HZ422");
    v = await emp.rpc<number>("change_task_status", { p_task: t, p_expected_version: v, p_action: "start" });
    await expectCode(mgr.rpc("set_progress", { p_task: t, p_expected_version: v, p_progress: 10 }), "HZ403");
    await expectCode(emp.rpc("change_task_status", { p_task: t, p_expected_version: v, p_action: "hold" }), "HZ422");
    v = await emp.rpc<number>("change_task_status", { p_task: t, p_expected_version: v, p_action: "hold", p_reason: "Waiting on data" });
    await expectCode(emp.rpc("set_progress", { p_task: t, p_expected_version: v, p_progress: 50 }), "HZ423");
    v = await emp.rpc<number>("change_task_status", { p_task: t, p_expected_version: v, p_action: "resume" });
    const resume = (await admin.query("select hold_seconds from public.task_status_events where task_id=$1 and action='resume'", [t])).rows[0];
    expect(resume.hold_seconds).toBeGreaterThanOrEqual(0);
  });

  it("stale versions are rejected", async () => {
    const t = await newTask(mgr);
    const v = (await task(t)).record_version;
    await emp.rpc("change_task_status", { p_task: t, p_expected_version: v, p_action: "start" });
    await expectCode(emp.rpc("change_task_status", { p_task: t, p_expected_version: v, p_action: "hold", p_reason: "stale" }), "HZ409");
  });

  it("cancel and reactivate keep history and re-enter the queue", async () => {
    const t = await newTask(mgr, { p_queue: "active" });
    let v = (await task(t)).record_version;
    v = await emp.rpc<number>("change_task_status", { p_task: t, p_expected_version: v, p_action: "cancel", p_reason: "Out of scope" });
    expect((await task(t)).priority_rank).toBeNull();
    await emp.rpc("change_task_status", { p_task: t, p_expected_version: v, p_action: "reactivate" });
    const after = await task(t);
    expect(after.status).toBe("not_started");
    expect(after.priority_rank).not.toBeNull();
  });

  it("employee moves planned → active and the manager is notified", async () => {
    const t = await newTask(mgr, { p_title: "Move me" });
    const v = (await task(t)).record_version;
    await emp.rpc("move_task_queue", { p_task: t, p_expected_version: v, p_queue: "active" });
    expect((await task(t)).queue).toBe("active");
    expect((await notificationsFor(ids.manager, "task.queue_moved")).length).toBeGreaterThan(0);
  });

  it("dependency cycles are rejected", async () => {
    const a = await newTask(mgr);
    const b = await newTask(mgr);
    const c = await newTask(mgr);
    await emp.rpc("add_task_dependency", { p_task: b, p_depends_on: a });
    await emp.rpc("add_task_dependency", { p_task: c, p_depends_on: b });
    await expectCode(mgr.rpc("add_task_dependency", { p_task: a, p_depends_on: c }), "HZ422");
  });

  it("archive removes a task from the ranked queue and restore puts it back", async () => {
    const t = await newTask(mgr, { p_queue: "active" });
    let v = (await task(t)).record_version;
    v = await mgr.rpc<number>("set_task_archived", { p_task: t, p_expected_version: v, p_archived: true, p_reason: "Duplicate" });
    expect((await task(t)).priority_rank).toBeNull();
    await expectCode(emp.rpc("change_task_status", { p_task: t, p_expected_version: v, p_action: "start" }), "HZ422");
    await emp.rpc("set_task_archived", { p_task: t, p_expected_version: v, p_archived: false });
    expect((await task(t)).priority_rank).not.toBeNull();
  });

  it("ranks stay contiguous 1..N per queue", async () => {
    const rows = (await admin.query(
      `select queue, array_agg(priority_rank order by priority_rank) r from public.tasks
       where assignee_id=$1 and priority_rank is not null group by queue`,
      [ids.employee],
    )).rows;
    for (const row of rows) expect(row.r).toEqual(row.r.map((_: number, i: number) => i + 1));
  });

  it("idempotent create with request id", async () => {
    const a = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Once", p_request_id: "req-123" });
    const b = await emp.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Once", p_request_id: "req-123" });
    expect(a).toBe(b);
  });

  it("categories are manager-managed", async () => {
    await expectCode(emp.rpc("create_category", { p_workspace: ids.ws, p_name: "Research" }), "HZ403");
    const id = await mgr.rpc<string>("create_category", { p_workspace: ids.ws, p_name: "Research" });
    await expectCode(mgr.rpc("create_category", { p_workspace: ids.ws, p_name: "research" }), "HZ422");
    await mgr.rpc("update_category", { p_category: id, p_archived: true });
  });

  it("audit is append-only", async () => {
    await expectCode(admin.query("delete from public.audit_events"), "HZ403");
  });
});
