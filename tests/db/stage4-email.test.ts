import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, expectCode, ids, resetDatabase, seed, type Actor } from "./harness";
import { dispatchEmails, type OutgoingMail } from "@/features/email/dispatch";
import type { ClaimedMessage } from "@/features/email/compose";

const SECRET = "test-dispatch-secret-0123456789-abcdefghij";
let admin: Client;
let mgr: Actor;
let emp: Actor;
let anon: Actor;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows as Json[];
const version = async (t: string) => (await rows("select record_version v from public.tasks where id=$1", [t]))[0]!.v as number;
const claim = () => anon.rpc<ClaimedMessage[]>("email_claim", { p_secret: SECRET, p_limit: 25 });
const report = (results: unknown) => anon.rpc<number>("email_report", { p_secret: SECRET, p_results: JSON.stringify(results) });

function run(send: (m: OutgoingMail) => Promise<{ messageId?: string }>) {
  return dispatchEmails({ appUrl: "https://hobzerve.example", claim, report: async (r) => void (await report(r)), send });
}

beforeAll(async () => {
  admin = await connect();
  await resetDatabase(admin);
  await seed(admin);
  mgr = as(admin, ids.manager);
  emp = as(admin, ids.employee);
  anon = as(admin, null);
});
afterAll(async () => {
  await admin?.end();
});

describe("Email (A15b, Decisions 57, 58, 60, 113)", () => {
  it("nothing is queued while email isn't configured", async () => {
    const t = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Before email", p_assignee: ids.employee });
    await mgr.rpc("change_deadline", { p_task: t, p_expected_version: await version(t), p_due_at: "2026-12-01T10:00:00Z", p_reason: "Plan" });
    expect(await rows("select * from public.email_deliveries")).toHaveLength(0);
  });

  it("important events queue an immediate email; ordinary ones don't; mutes are respected", async () => {
    await admin.query("select app.configure_email('https://hobzerve.example/api/email/dispatch', $1)", [SECRET]);
    const t = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Deadline moves", p_assignee: ids.employee });
    expect(await rows("select * from public.email_deliveries")).toHaveLength(0); // task.created is not important
    await mgr.rpc("change_deadline", { p_task: t, p_expected_version: await version(t), p_due_at: "2026-12-02T10:00:00Z", p_reason: "Client asked" });
    await mgr.rpc("set_priority_level", { p_task: t, p_level: "urgent" });
    const q = await rows("select kind, status, recipient_id from public.email_deliveries");
    expect(q).toHaveLength(2);
    expect(q.every((r) => r.kind === "immediate" && r.status === "pending" && r.recipient_id === ids.employee)).toBe(true);

    await emp.rpc("set_email_preferences", { p_immediate: false, p_digest: true, p_reports: true });
    await mgr.rpc("set_priority_level", { p_task: t, p_level: "low" });
    expect(await rows("select * from public.email_deliveries")).toHaveLength(2);
    await emp.rpc("set_email_preferences", { p_immediate: true, p_digest: true, p_reports: true });
  });

  it("the dispatch RPCs require the secret; config and other people's deliveries stay private", async () => {
    await expectCode(anon.rpc("email_claim", { p_secret: "wrong", p_limit: 5 }), "HZ403");
    await expectCode(anon.rpc("email_report", { p_secret: "", p_results: [] }), "HZ403");
    await expectCode(emp.query("select * from app.email_config"), "42501");
    await expectCode(anon.query("select * from public.email_deliveries"), "42501");
    expect(await mgr.query("select * from public.email_deliveries")).toHaveLength(0);
    expect((await emp.query("select * from public.email_deliveries")).length).toBe(2);
    await expectCode(emp.query("update public.email_deliveries set status='sent'"), "42501");
  });

  it("groups one person's important notices into one email and records it as sent", async () => {
    const sent: OutgoingMail[] = [];
    const res = await run(async (m) => {
      sent.push(m);
      return { messageId: "<m1@test>" };
    });
    expect(res).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sent[0]!.to).toBe("abdelwahab.magdy@docspert.com");
    expect(sent[0]!.subject).toBe("Hobzerve: 2 important updates");
    expect(sent[0]!.text).toContain("https://hobzerve.example/tasks/");
    expect(sent[0]!.html).toContain("Client asked");
    const q = await rows("select status, message_id, batch_id from public.email_deliveries");
    expect(q.every((r) => r.status === "sent" && r.message_id === "<m1@test>")).toBe(true);
    expect(new Set(q.map((r) => r.batch_id)).size).toBe(1);
  });

  it("a failed send is recorded, not retried, and the in-app notification stays", async () => {
    const t = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Fails to send", p_assignee: ids.employee });
    await mgr.rpc("change_deadline", { p_task: t, p_expected_version: await version(t), p_due_at: "2026-12-03T10:00:00Z", p_reason: "Shift" });
    const res = await run(async () => {
      throw new Error("535 Username and Password not accepted");
    });
    expect(res.failed).toBe(1);
    const d = (await rows("select * from public.email_deliveries where status <> 'sent'"))[0]!;
    expect([d.status, d.error]).toEqual(["failed", "535 Username and Password not accepted"]);
    const tick = (await rows("select app.email_tick() t"))[0]!.t;
    expect(tick.pending).toBe(0);
    expect(await claim()).toEqual([]);
    const n = await rows("select read_at from public.notifications where id = $1", [d.notification_id]);
    expect(n).toHaveLength(1);
  });

  it("a send stuck for 10 minutes is marked failed, not retried", async () => {
    const t = await mgr.rpc<string>("create_task", { p_workspace: ids.ws, p_title: "Stuck", p_assignee: ids.employee });
    await mgr.rpc("change_deadline", { p_task: t, p_expected_version: await version(t), p_due_at: "2026-12-04T10:00:00Z", p_reason: "Stuck" });
    const claimed = await claim();
    expect(claimed).toHaveLength(1);
    await admin.query("update public.email_deliveries set attempted_at = now() - interval '11 minutes' where status = 'sending'");
    await admin.query("select app.email_tick()");
    const d = (await rows("select status, error from public.email_deliveries where id = $1", [claimed[0]!.delivery_ids[0]]))[0]!;
    expect(d.status).toBe("failed");
    expect(d.error).toMatch(/not retried/);
  });

  it("automatic reports are emailed with the PDF attached", async () => {
    await emp.rpc("add_attendance_session", {
      p_workspace: ids.ws, p_started_at: "2026-09-21T06:00:00Z", p_ended_at: "2026-09-21T15:00:00Z", p_reason: "Backfill",
    });
    await admin.query("select app.close_due_weeks()");
    const queued = await rows("select count(*)::int c from public.email_deliveries where kind = 'report' and status = 'pending'");
    expect(queued[0]!.c).toBeGreaterThan(0);
    const sent: OutgoingMail[] = [];
    await run(async (m) => {
      sent.push(m);
      return {};
    });
    const reports = sent.filter((m) => m.attachments?.length);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]!.subject).toMatch(/^Hobzerve: (Weekly|Monthly) report/);
    expect(reports[0]!.attachments![0]!.contentType).toBe("application/pdf");
    expect(reports[0]!.attachments![0]!.content.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("daily digest: once per day, only notices not already emailed, skipped when opted out", async () => {
    await mgr.rpc("set_digest_time", { p_workspace: ids.ws, p_time: "00:00" });
    await emp.rpc("create_task", { p_workspace: ids.ws, p_title: "Something ordinary" }); // notifies the manager, not important
    await emp.rpc("set_email_preferences", { p_immediate: true, p_digest: false, p_reports: true });
    await admin.query("select app.enqueue_digests()");
    await admin.query("select app.enqueue_digests()");
    const d = await rows("select recipient_id, status, cardinality(notification_ids) n from public.email_deliveries where kind = 'digest' order by recipient_id");
    expect(d).toHaveLength(2);
    const m = d.find((x) => x.recipient_id === ids.manager)!;
    const e = d.find((x) => x.recipient_id === ids.employee)!;
    expect(m.status).toBe("pending");
    expect(m.n).toBeGreaterThan(0);
    expect(e.status).toBe("skipped");
    const emailed = await rows(
      "select count(*)::int c from public.email_deliveries dg, unnest(dg.notification_ids) nid where dg.kind='digest' and exists (select 1 from public.email_deliveries x where x.kind <> 'digest' and nid = any (x.notification_ids))",
    );
    expect(emailed[0]!.c).toBe(0);
    const sent: OutgoingMail[] = [];
    await run(async (mail) => {
      sent.push(mail);
      return {};
    });
    expect(sent.some((s) => s.to === "ahmed.badr@docspert.com" && s.subject.startsWith("Hobzerve daily digest"))).toBe(true);
    const status = await emp.rpc<Json>("email_status", { p_workspace: ids.ws });
    expect(status).toMatchObject({ configured: true, digest_time: "00:00", preferences: { digest: false } });
    await expectCode(emp.rpc("set_digest_time", { p_workspace: ids.ws, p_time: "09:00" }), "HZ403");
  });
});
