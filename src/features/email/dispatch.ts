import "server-only";
import { buildReportDocument } from "@/features/reports/document";
import { renderReportPdf } from "@/features/reports/render";
import type { ReportSnapshot } from "@/features/reports/types";
import { composeEmail, type ClaimedMessage } from "./compose";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export interface DispatchDeps {
  claim: () => Promise<ClaimedMessage[]>;
  report: (results: Array<{ delivery_ids: string[]; ok: boolean; error?: string; message_id?: string }>) => Promise<void>;
  send: (mail: OutgoingMail) => Promise<{ messageId?: string }>;
  appUrl: string;
}

/**
 * One dispatch run: claim pending deliveries, send each message once, record the outcome.
 * A failure is recorded and never retried (Decision 58); the in-app notification is unaffected.
 */
export async function dispatchEmails(deps: DispatchDeps): Promise<{ sent: number; failed: number; skipped: number }> {
  const messages = await deps.claim();
  const results: Array<{ delivery_ids: string[]; ok: boolean; error?: string; message_id?: string }> = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const m of messages) {
    try {
      const composed = composeEmail(m, deps.appUrl);
      if (!composed) {
        skipped++;
        results.push({ delivery_ids: m.delivery_ids, ok: false, error: "Recipient has no email address." });
        continue;
      }
      const mail: OutgoingMail = { ...composed };
      if (m.kind === "report" && m.report) {
        const r = m.report as unknown as ReportSnapshot;
        const pdf = await renderReportPdf(buildReportDocument(r));
        mail.attachments = [
          {
            filename: `hobzerve-${r.kind}-${r.period_start ?? "report"}-${r.source_fingerprint.slice(0, 8)}.pdf`,
            content: Buffer.from(pdf),
            contentType: "application/pdf",
          },
        ];
      }
      const info = await deps.send(mail);
      sent++;
      results.push({ delivery_ids: m.delivery_ids, ok: true, message_id: info.messageId });
    } catch (e) {
      failed++;
      results.push({ delivery_ids: m.delivery_ids, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (results.length) await deps.report(results);
  return { sent, failed, skipped };
}
