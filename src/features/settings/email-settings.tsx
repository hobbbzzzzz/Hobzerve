"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc, unwrap } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/dates";
import { EnvelopeSimple, Warning } from "@/components/icons";

interface Status {
  configured: boolean;
  digest_time: string;
  preferences: { immediate: boolean; digest: boolean; reports: boolean };
  email: string;
}

interface Delivery {
  id: string;
  kind: "immediate" | "report" | "digest";
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  error: string | null;
  created_at: string;
  sent_at: string | null;
  notification_ids: string[];
}

const KIND: Record<Delivery["kind"], string> = { immediate: "Important update", report: "Report (PDF)", digest: "Daily digest" };
const TONE = { pending: "warning", sending: "warning", sent: "success", failed: "danger", skipped: "neutral" } as const;

/** Email channel (Decisions 55, 57, 58, 113): personal preferences, digest time (manager) and delivery history. */
export function EmailSettingsCard() {
  const { workspace, isManager } = useWorkspace();
  const { call, pending } = useRpc();
  const status = useLoad(async () => {
    const { data, error } = await getBrowserClient().rpc("email_status", { p_workspace: workspace.id });
    if (error) throw error;
    return data as Status;
  }, [workspace.id]);
  const history = useLoad(
    async () =>
      unwrap(
        await getBrowserClient()
          .from("email_deliveries")
          .select("id, kind, status, error, created_at, sent_at, notification_ids")
          .neq("status", "skipped")
          .order("created_at", { ascending: false })
          .limit(15)
          .returns<Delivery[]>(),
      ) ?? [],
    [],
  );
  const [time, setTime] = useState<string | null>(null);
  const s = status.data;

  async function toggle(key: keyof Status["preferences"], value: boolean) {
    if (!s) return;
    const next = { ...s.preferences, [key]: value };
    const r = await call("set_email_preferences", { p_immediate: next.immediate, p_digest: next.digest, p_reports: next.reports }, { success: "Email preferences saved" });
    if (r.ok) status.reload();
  }

  return (
    <Card>
      <CardHeader icon={<EnvelopeSimple size={20} />} title="Email" subtitle={s ? `Sent to ${s.email}` : undefined} />
      <div className="flex flex-col gap-4 px-5 pb-5 text-sm">
        {!s && status.loading ? (
          <Spinner />
        ) : status.error ? (
          <p className="text-danger">{status.error}</p>
        ) : s ? (
          <>
            {!s.configured && (
              <p className="flex items-start gap-2 rounded-[12px] bg-[#fbf0e2] px-3 py-2 text-warning">
                <Warning size={18} className="mt-0.5 shrink-0" />
                Email isn&apos;t switched on for this workspace yet, so nothing is sent.{" "}
                {isManager ? "Setup steps are in docs/RUNBOOK.md (Email)." : "Your manager can switch it on."}
              </p>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">Send me</legend>
              {(
                [
                  ["immediate", "Important updates right away", "Deadline, priority and ranking changes, revision requests, payroll adjustments. Several at once arrive as one email."],
                  ["digest", `A daily digest at ${s.digest_time} (Cairo)`, "Everything else from the day, in one email. Nothing new → no email."],
                  ["reports", "Weekly and monthly reports", "Sent with the PDF attached when a week or month closes."],
                ] as const
              ).map(([key, label, hint]) => (
                <label key={key} className="flex items-start gap-3 rounded-[12px] border border-line px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[#5566e0]"
                    checked={s.preferences[key]}
                    disabled={pending}
                    onChange={(e) => toggle(key, e.target.checked)}
                  />
                  <span>
                    <span className="block font-medium">{label}</span>
                    <span className="block text-xs text-ink-soft">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-ink-soft">Email is an extra copy. Every notice also stays in the notification center, even if an email fails.</p>

            {isManager && (
              <div className="flex flex-wrap items-end gap-2 rounded-[12px] border border-line p-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                  Daily digest time for the workspace (Cairo)
                  <Input type="time" className="h-10 w-36" value={time ?? s.digest_time} onChange={(e) => setTime(e.target.value)} />
                </label>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!time || time === s.digest_time}
                  loading={pending}
                  onClick={async () => {
                    const r = await call("set_digest_time", { p_workspace: workspace.id, p_time: time }, { success: "Digest time saved" });
                    if (r.ok) {
                      setTime(null);
                      status.reload();
                    }
                  }}
                >
                  Save
                </Button>
              </div>
            )}

            <section>
              <h3 className="mb-2 font-medium">Recent emails to you</h3>
              {(history.data ?? []).length === 0 ? (
                <p className="text-ink-soft">None yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {history.data!.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <Badge tone={TONE[d.status]}>{d.status === "failed" ? "Failed — not retried" : d.status}</Badge>
                      <span>{KIND[d.kind]}</span>
                      <span className="text-xs text-ink-soft">
                        {formatDateTime(d.sent_at ?? d.created_at)}
                        {d.kind !== "report" && ` · ${d.notification_ids.length} notice${d.notification_ids.length === 1 ? "" : "s"}`}
                      </span>
                      {d.error && <span className="w-full text-xs text-danger">{d.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </Card>
  );
}
