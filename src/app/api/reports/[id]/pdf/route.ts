import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { buildReportDocument } from "@/features/reports/document";
import { renderReportPdf } from "@/features/reports/render";
import type { ReportSnapshot } from "@/features/reports/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renders a stored report snapshot as PDF (the only download format, Decision 111).
 * Access is checked by the database with the caller's own session; nothing here uses elevated keys.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await getServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { data, error } = await supabase.rpc("get_report", { p_id: id });
  if (error || !data) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const report = data as ReportSnapshot;
  const bytes = await renderReportPdf(buildReportDocument(report));
  const name = `hobzerve-${report.kind}-${report.period_start ?? report.task_id?.slice(0, 8) ?? "report"}-${report.source_fingerprint.slice(0, 8)}.pdf`;
  const inline = new URL(request.url).searchParams.get("inline") === "1";

  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
