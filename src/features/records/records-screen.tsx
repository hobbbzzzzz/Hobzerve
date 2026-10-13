"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Segmented, Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, unwrap } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { addDays, cairoLocalToIso, cairoToday, formatDateTime, formatDuration } from "@/lib/dates";
import { AnalyticsNav } from "@/features/analytics/analytics-nav";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
type Kind = "attendance" | "activity" | "time" | "audit";
const PAGE = 50;

const dur = (a: string, b: string | null) => (b ? formatDuration((Date.parse(b) - Date.parse(a)) / 1000) : "open");

/** Raw records, on screen only (Decision 111). Filterable and paginated; there is deliberately no export. */
export function RecordsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { workspace, userId, isManager, employees, nameOf } = useWorkspace();
  const subject = isManager ? (params.get("user") ?? employees[0]?.user_id ?? null) : userId;
  const [kind, setKind] = useState<Kind>("attendance");
  const [from, setFrom] = useState(addDays(cairoToday(), -30));
  const [to, setTo] = useState(cairoToday());
  const [removed, setRemoved] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const fromIso = cairoLocalToIso(from, "00:00");
  const toIso = cairoLocalToIso(addDays(to, 1), "00:00");

  const data = useLoad(async () => {
    if (!subject) return { rows: [] as Json[], total: 0, titles: new Map<string, string>() };
    const sb = getBrowserClient();
    const range = [page * PAGE, page * PAGE + PAGE - 1] as const;
    let res: { data: Json[] | null; error: Json; count: number | null };
    if (kind === "audit") {
      let q = sb
        .from("audit_events")
        .select("id, occurred_at, actor_id, event_type, summary, task_id, metadata_json, old_json, new_json", { count: "exact" })
        .eq("workspace_id", workspace.id)
        .eq("subject_user_id", subject)
        .gte("occurred_at", fromIso)
        .lt("occurred_at", toIso)
        .order("occurred_at", { ascending: false })
        .range(...range);
      if (search.trim()) q = q.ilike("summary", `%${search.trim().replace(/[%_]/g, "")}%`);
      res = await q;
    } else {
      const table = kind === "attendance" ? "attendance_sessions" : kind === "activity" ? "live_activity_segments" : "task_time_entries";
      let q = sb
        .from(table)
        .select("*", { count: "exact" })
        .eq("workspace_id", workspace.id)
        .eq("user_id", subject)
        .gte("started_at", fromIso)
        .lt("started_at", toIso)
        .order("started_at", { ascending: false })
        .range(...range);
      if (!removed) q = q.is("voided_at", null);
      res = await q;
    }
    if (res.error) throw res.error;
    const rows = res.data ?? [];
    const taskIds = [...new Set(rows.map((r) => r.task_id).filter(Boolean))] as string[];
    const titles = new Map<string, string>();
    if (taskIds.length) {
      const t = unwrap(await sb.from("tasks").select("id, title").in("id", taskIds).returns<Array<{ id: string; title: string }>>()) ?? [];
      t.forEach((x) => titles.set(x.id, x.title));
    }
    return { rows, total: res.count ?? rows.length, titles };
  }, [workspace.id, subject, kind, fromIso, toIso, removed, search, page]);

  const columns = useMemo(() => {
    const title = (id: string | null) => (id ? (data.data?.titles.get(id) ?? "Task") : "—");
    const voided = (r: Json) => (r.voided_at ? <Badge tone="danger">Removed: {r.void_reason ?? "relabelled"}</Badge> : null);
    switch (kind) {
      case "attendance":
        return [
          { h: "Start", f: (r: Json) => formatDateTime(r.started_at) },
          { h: "End", f: (r: Json) => (r.ended_at ? formatDateTime(r.ended_at) : <Badge tone="warning">Open</Badge>) },
          { h: "Duration", f: (r: Json) => dur(r.started_at, r.ended_at) },
          { h: "Origin", f: (r: Json) => (r.origin === "manual" ? "Added later" : "Clock") },
          { h: "Notes", f: (r: Json) => <span className="flex flex-wrap gap-1">{r.summary && <span>“{r.summary}”</span>}{voided(r)}</span> },
        ];
      case "activity":
        return [
          { h: "Start", f: (r: Json) => formatDateTime(r.started_at) },
          { h: "End", f: (r: Json) => (r.ended_at ? formatDateTime(r.ended_at) : <Badge tone="warning">Running</Badge>) },
          { h: "Duration", f: (r: Json) => dur(r.started_at, r.ended_at) },
          { h: "Activity", f: (r: Json) => (r.kind === "task" ? title(r.task_id) : r.kind === "general" ? r.general_type : <span className="text-warning">Unassigned</span>) },
          { h: "Notes", f: (r: Json) => <span className="flex flex-wrap gap-1">{r.split_from && <Badge tone="lavender">Re-labelled piece</Badge>}{r.voided_at && <Badge tone="danger">Replaced</Badge>}</span> },
        ];
      case "time":
        return [
          { h: "Start", f: (r: Json) => formatDateTime(r.started_at) },
          { h: "End", f: (r: Json) => (r.ended_at ? formatDateTime(r.ended_at) : <Badge tone="warning">Running</Badge>) },
          { h: "Duration", f: (r: Json) => dur(r.started_at, r.ended_at) },
          { h: "Task", f: (r: Json) => title(r.task_id) },
          { h: "Notes", f: (r: Json) => <span className="flex flex-wrap gap-1"><Badge tone={r.source === "timer" ? "lavender" : "neutral"}>{r.source}</Badge>{r.overlap_acknowledged && <Badge tone="warning">overlap</Badge>}{voided(r)}</span> },
        ];
      default:
        return [
          { h: "When", f: (r: Json) => formatDateTime(r.occurred_at) },
          { h: "By", f: (r: Json) => nameOf(r.actor_id) },
          { h: "Event", f: (r: Json) => <code className="text-xs">{r.event_type}</code> },
          { h: "Summary", f: (r: Json) => <span>{r.summary}{r.metadata_json?.body && <span className="block text-xs text-ink-soft">“{r.metadata_json.body}”</span>}</span> },
        ];
    }
  }, [kind, data.data, nameOf]);

  function setUser(u: string) {
    const q = new URLSearchParams(params.toString());
    q.set("user", u);
    setPage(0);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Records</h1>
          <p className="text-sm text-ink-soft">Every raw record, newest first. On screen only — raw records are never exported (reports are the downloadable form).</p>
        </div>
        <AnalyticsNav />
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-3">
        <Segmented
          label="Record type"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPage(0);
          }}
          options={[
            { value: "attendance", label: "Attendance" },
            { value: "activity", label: "Activity" },
            { value: "time", label: "Task time" },
            { value: "audit", label: "Audit log" },
          ]}
        />
        {isManager && employees.length > 0 && (
          <Select aria-label="Employee" className="h-10 w-48" value={subject ?? ""} onChange={(e) => setUser(e.target.value)}>
            {employees.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.profile.display_name}
              </option>
            ))}
          </Select>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          From
          <Input type="date" className="h-10 w-40" value={from} onChange={(e) => e.target.value && (setFrom(e.target.value), setPage(0))} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          To
          <Input type="date" className="h-10 w-40" value={to} onChange={(e) => e.target.value && (setTo(e.target.value), setPage(0))} />
        </label>
        {kind === "audit" ? (
          <Input aria-label="Search audit summaries" placeholder="Search summaries" className="h-10 w-56" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        ) : (
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[#5566e0]" checked={removed} onChange={(e) => { setRemoved(e.target.checked); setPage(0); }} />
            Include removed/replaced
          </label>
        )}
      </div>

      <Card className="overflow-hidden">
        {data.error && <p className="p-4 text-sm text-danger">{data.error}</p>}
        {!data.data && data.loading ? (
          <div className="py-10 text-center">
            <Spinner />
          </div>
        ) : data.data && data.data.rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-soft">No records in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt">
                <tr className="text-left text-xs text-ink-soft">
                  {columns.map((c) => (
                    <th key={c.h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">
                      {c.h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {data.data?.rows.map((r) => (
                  <tr key={r.id} className={r.voided_at ? "border-t border-line text-ink-soft" : "border-t border-line"}>
                    {columns.map((c) => (
                      <td key={c.h} className="px-4 py-2 align-top">
                        {c.f(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.data && data.data.total > 0 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Newer
            </Button>
            <span className="tabular text-ink-soft">
              {page * PAGE + 1}–{Math.min(data.data.total, (page + 1) * PAGE)} of {data.data.total}
            </span>
            <Button size="sm" disabled={(page + 1) * PAGE >= data.data.total} onClick={() => setPage((p) => p + 1)}>
              Older
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
