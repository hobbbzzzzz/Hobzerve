import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, ids, resetDatabase, seed, type Actor } from "./harness";
import { buildReportDocument, footerLines } from "@/features/reports/document";
import { renderReportPdf } from "@/features/reports/render";
import type { ReportSnapshot } from "@/features/reports/types";

let admin: Client;
let emp: Actor;
let mgr: Actor;

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function pdfText(bytes: Uint8Array): string | null {
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "hz-pdf-"));
    const file = path.join(dir, "r.pdf");
    writeFileSync(file, bytes);
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  } catch {
    return null; // pdftotext not installed (e.g. CI): structural checks below still run
  }
}

beforeAll(async () => {
  admin = await connect();
  await resetDatabase(admin);
  await seed(admin);
  emp = as(admin, ids.employee);
  mgr = as(admin, ids.manager);
  const t = await mgr.rpc<string>("create_task", {
    p_workspace: ids.ws, p_title: "Prepare Q3 summary — مراجعة", p_assignee: ids.employee, p_expected_deliverables: ["Deck"],
  });
  await emp.rpc("create_task", { p_workspace: ids.ws, p_title: "Collect inputs", p_parent: t });
  await emp.rpc("add_attendance_session", {
    p_workspace: ids.ws, p_started_at: "2026-09-21T06:00:00Z", p_ended_at: "2026-09-21T15:30:00Z", p_reason: "Backfill", p_kind: "task", p_task: t,
  });
  await admin.query("select app.close_due_weeks()");
});

afterAll(async () => {
  await admin?.end();
});

describe("PDF reports (A16, A17)", () => {
  it("renders every report kind, deterministically, with the fingerprint in the footer", async () => {
    const parent = (await admin.query("select id from public.tasks where parent_task_id is null limit 1")).rows[0].id;
    const reportIds = [
      await emp.rpc<string>("create_report", { p_workspace: ids.ws, p_kind: "daily", p_from: "2026-09-21" }),
      (await admin.query("select id from public.report_snapshots where auto and kind='weekly' and period_start='2026-09-19'")).rows[0].id,
      (await admin.query("select id from public.report_snapshots where auto and kind='monthly' and period_start='2026-09-01'")).rows[0].id,
      await mgr.rpc<string>("create_report", { p_workspace: ids.ws, p_kind: "task", p_task: parent }),
      await mgr.rpc<string>("create_report", { p_workspace: ids.ws, p_kind: "project", p_task: parent }),
    ];
    for (const id of reportIds) {
      const r = await emp.rpc<ReportSnapshot>("get_report", { p_id: id });
      const doc = buildReportDocument(r);
      expect(doc.footer[0]).toContain(r.source_fingerprint);
      expect(footerLines(r).join(" ")).toContain(r.id);
      const a = await renderReportPdf(doc);
      const b = await renderReportPdf(buildReportDocument(r));
      expect(Buffer.from(a.slice(0, 5)).toString()).toBe("%PDF-");
      expect(sha(a)).toBe(sha(b));
      const text = pdfText(a);
      if (text !== null) {
        expect(text.replace(/\s+/g, "")).toContain(r.source_fingerprint);
        expect(text).toContain("Page 1 of");
        if (r.kind === "weekly") expect(text).toContain("9h 30m");
        if (r.kind === "task") expect(text).toContain("appear as “?”");
      }
    }
  });
});
