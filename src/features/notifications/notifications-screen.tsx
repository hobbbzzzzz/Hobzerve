"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Segmented, Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc, unwrap } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatDate, formatDateTime, isoToCairoLocal } from "@/lib/dates";
import type { Notification } from "@/lib/types";
import { Bell, CheckCircle, Warning } from "@/components/icons";

const PAGE = 50;

export function NotificationsScreen() {
  const router = useRouter();
  const { userId } = useWorkspace();
  const { call, pending } = useRpc();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [limit, setLimit] = useState(PAGE);
  const { data, loading, error } = useLoad(async () => {
    let q = getBrowserClient().from("notifications").select("*").eq("recipient_id", userId).order("created_at", { ascending: false }).limit(limit + 1);
    if (filter === "unread") q = q.is("read_at", null);
    return unwrap(await q.returns<Notification[]>()) ?? [];
  }, [userId, filter, limit]);

  const rows = (data ?? []).slice(0, limit);
  const hasMore = (data ?? []).length > limit;

  // Group adjacent notices with the same group key for display; every underlying notice is kept (Decision 36).
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: Array<{ head: Notification; members: Notification[] }> }> = [];
    for (const n of rows) {
      const day = isoToCairoLocal(n.created_at).date;
      let g = out.at(-1);
      if (!g || g.day !== day) {
        g = { day, items: [] };
        out.push(g);
      }
      const last = g.items.at(-1);
      if (last && last.head.group_key === n.group_key && !n.critical && !last.head.critical) last.members.push(n);
      else g.items.push({ head: n, members: [n] });
    }
    return out;
  }, [rows]);

  async function open(item: { head: Notification; members: Notification[] }) {
    const unread = item.members.filter((m) => !m.read_at).map((m) => m.id);
    if (unread.length) await call("mark_notifications_read", { p_ids: unread }, { silent: true });
    if (item.head.link) router.push(item.head.link);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-ink-soft">Unread notices stay here until you read them, with their original times (Cairo).</p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            label="Filter"
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setLimit(PAGE);
            }}
            options={[
              { value: "all", label: "All" },
              { value: "unread", label: "Unread" },
            ]}
          />
          <Button size="sm" icon={<CheckCircle size={16} />} loading={pending} onClick={() => call("mark_notifications_read", { p_ids: null }, { success: "All marked as read" })}>
            Mark All Read
          </Button>
        </div>
      </div>

      {error && <p className="rounded-[14px] bg-danger-tint px-4 py-3 text-sm text-danger">{error}</p>}
      {!data && loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Bell size={24} />} title={filter === "unread" ? "You're All Caught Up" : "No Notifications Yet"}>
            Changes the other person makes to your work show up here.
          </EmptyState>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.day} className="card overflow-hidden">
            <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">{formatDate(`${g.day}T12:00:00Z`)}</h2>
            <ul className="divide-y divide-line">
              {g.items.map((item) => {
                const unread = item.members.some((m) => !m.read_at);
                return (
                  <li key={item.head.id}>
                    <button
                      type="button"
                      onClick={() => open(item)}
                      className={clsx("flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-alt", unread && "bg-unread")}
                    >
                      <span className={clsx("mt-1.5 size-2.5 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={clsx("block text-sm", unread && "font-semibold")}>
                          {item.head.title}
                          {item.members.length > 1 && <span className="text-ink-soft"> · {item.members.length} updates</span>}
                        </span>
                        {item.head.body && <span className="mt-0.5 block text-sm text-ink-soft">“{item.head.body}”</span>}
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                          {formatDateTime(item.head.created_at)}
                          {item.head.critical && (
                            <Badge tone="warning" icon={<Warning size={12} />}>
                              Important
                            </Badge>
                          )}
                          {unread && <span className="sr-only">Unread</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {hasMore && (
        <div className="text-center">
          <Button onClick={() => setLimit((l) => l + PAGE)}>Load Older</Button>
        </div>
      )}
    </div>
  );
}
