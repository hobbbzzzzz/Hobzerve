"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc, unwrap } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { addDays, cairoToday, formatDateTime } from "@/lib/dates";
import { PRIORITY_LABEL, PRIORITY_ORDER, WORK_TYPE_LABEL } from "@/lib/labels";
import type { Category, Task, TaskWorkType } from "@/lib/types";
import { ArrowClockwise, DownloadSimple, Eye, FilePdf, Fingerprint, Plus, Warning } from "@/components/icons";
import { AnalyticsNav } from "@/features/analytics/analytics-nav";
import { REPORT_KIND_LABEL, type ReportKind, type ReportListItem } from "./types";

const PAGE = 20;
const COLUMNS = "id, workspace_id, kind, subject_user_id, task_id, period_start, period_end, filters, title, source_fingerprint, renderer_version, auto, created_by, generated_at";

export function ReportsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { workspace, userId, isManager, employees, nameOf } = useWorkspace();
  const subject = isManager ? (params.get("user") ?? employees[0]?.user_id ?? null) : userId;
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);

  const list = useLoad(async () => {
    if (!subject) return { rows: [] as ReportListItem[], total: 0, changes: new Map<string, boolean>() };
    const sb = getBrowserClient();
    const { data, error, count } = await sb
      .from("report_snapshots")
      .select(COLUMNS, { count: "exact" })
      .eq("workspace_id", workspace.id)
      .eq("subject_user_id", subject)
      .order("generated_at", { ascending: false })
      .order("period_start", { ascending: false, nullsFirst: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)
      .returns<ReportListItem[]>();
    if (error) throw error;
    const rows = data ?? [];
    const changes = new Map<string, boolean>();
    if (rows.length) {
      const { data: ch } = await sb.rpc("report_changes", { p_ids: rows.map((r) => r.id) });
      for (const c of (ch ?? []) as Array<{ id: string; changed: boolean }>) changes.set(c.id, c.changed);
    }
    return { rows, total: count ?? rows.length, changes };
  }, [workspace.id, subject, page]);

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
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-ink-soft">
            Reports download as PDF only. Each one is a frozen snapshot with a SHA-256 fingerprint; if the records behind it change later, it&apos;s marked as changed.
          </p>
        </div>
        <AnalyticsNav />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {isManager && employees.length > 0 ? (
          <Select aria-label="Employee" className="h-10 w-56" value={subject ?? ""} onChange={(e) => setUser(e.target.value)}>
            {employees.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.profile.display_name}
              </option>
            ))}
          </Select>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button icon={<ArrowClockwise size={16} />} onClick={list.reload} loading={list.loading && !!list.data}>
            Re-Check Changes
          </Button>
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating((x) => !x)} aria-expanded={creating}>
            New Report
          </Button>
        </div>
      </div>

      {creating && subject && <CreateReport subject={subject} onDone={() => { setCreating(false); setPage(0); list.reload(); }} />}

      <Card>
        <CardHeader icon={<FilePdf size={20} />} title="Snapshots" subtitle="Weekly and monthly reports are generated automatically after each weekly close" />
        {list.error && <p className="px-5 pb-4 text-sm text-danger">{list.error}</p>}
        {!list.data && list.loading ? (
          <div className="py-10 text-center">
            <Spinner />
          </div>
        ) : list.data && list.data.rows.length === 0 ? (
          <EmptyState icon={<FilePdf size={24} />} title="No Reports Yet">
            The first weekly report appears after the first weekly close. You can also generate one now.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {list.data?.rows.map((r) => {
              const changed = list.data!.changes.get(r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.title}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                      <Badge tone="primary">{REPORT_KIND_LABEL[r.kind]}</Badge>
                      {r.auto ? <Badge tone="teal">Automatic</Badge> : <span>by {nameOf(r.created_by)}</span>}
                      <span>· {formatDateTime(r.generated_at)}</span>
                      <span className="tabular inline-flex items-center gap-1" title={r.source_fingerprint}>
                        <Fingerprint size={12} /> {r.source_fingerprint.slice(0, 12)}…
                      </span>
                      {Object.keys(r.filters ?? {}).length > 0 && <Badge>filtered</Badge>}
                    </p>
                  </div>
                  {changed === true && (
                    <Badge tone="warning" icon={<Warning size={12} />}>
                      Changed since export
                    </Badge>
                  )}
                  {changed === false && <Badge tone="success">Matches current records</Badge>}
                  <div className="flex gap-1">
                    <a
                      href={`/api/reports/${r.id}/pdf?inline=1`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-sm font-medium text-ink-soft hover:bg-surface-alt hover:text-ink"
                    >
                      <Eye size={16} /> View
                    </a>
                    <a
                      href={`/api/reports/${r.id}/pdf`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-[12px] border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-alt"
                    >
                      <DownloadSimple size={16} /> PDF
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {list.data && list.data.total > PAGE && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
            <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Newer
            </Button>
            <span className="tabular text-ink-soft">
              {page * PAGE + 1}–{Math.min(list.data.total, (page + 1) * PAGE)} of {list.data.total}
            </span>
            <Button size="sm" disabled={(page + 1) * PAGE >= list.data.total} onClick={() => setPage((p) => p + 1)}>
              Older
            </Button>
          </div>
        )}
      </Card>
      <p className="text-xs text-ink-soft">Raw attendance, activity and audit records are viewable under Records — on screen only, never exported.</p>
    </div>
  );
}

function CreateReport({ subject, onDone }: { subject: string; onDone: () => void }) {
  const { workspace } = useWorkspace();
  const { call, pending } = useRpc();
  const [kind, setKind] = useState<ReportKind>("weekly");
  const [day, setDay] = useState(addDays(cairoToday(), -1));
  const [month, setMonth] = useState(cairoToday().slice(0, 7));
  const [taskId, setTaskId] = useState("");
  const [category, setCategory] = useState("");
  const [workType, setWorkType] = useState("");
  const [priority, setPriority] = useState("");
  const data = useLoad(async () => {
    const sb = getBrowserClient();
    const [tasks, cats] = await Promise.all([
      sb.from("tasks").select("id, title, parent_task_id").eq("workspace_id", workspace.id).eq("assignee_id", subject).is("archived_at", null).order("created_at", { ascending: false }).limit(300).returns<Pick<Task, "id" | "title" | "parent_task_id">[]>(),
      sb.from("categories").select("*").eq("workspace_id", workspace.id).order("sort_order").returns<Category[]>(),
    ]);
    return { tasks: unwrap(tasks) ?? [], cats: unwrap(cats) ?? [] };
  }, [workspace.id, subject]);
  const tasks = (data.data?.tasks ?? []).filter((t) => kind !== "project" || !t.parent_task_id);
  const needsTask = kind === "task" || kind === "project";
  const filterable = kind === "weekly" || kind === "monthly";

  async function submit() {
    const r = await call<string>(
      "create_report",
      {
        p_workspace: workspace.id,
        p_kind: kind,
        p_user: needsTask ? null : subject,
        p_from: kind === "monthly" ? `${month}-01` : needsTask ? null : day,
        p_task: needsTask ? taskId : null,
        p_filters: filterable ? Object.fromEntries(Object.entries({ category_id: category, work_type: workType, priority }).filter(([, v]) => v)) : {},
      },
      { success: "Report generated" },
    );
    if (r.ok) onDone();
  }

  return (
    <Card className="p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Report">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
              {(Object.keys(REPORT_KIND_LABEL) as ReportKind[]).map((k) => (
                <option key={k} value={k}>
                  {REPORT_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {kind === "daily" && <Field label="Day">{(id) => <Input id={id} type="date" max={cairoToday()} value={day} onChange={(e) => setDay(e.target.value)} />}</Field>}
        {kind === "weekly" && (
          <Field label="Any day in the week" hint="Weeks run Saturday–Friday">
            {(id) => <Input id={id} type="date" max={cairoToday()} value={day} onChange={(e) => setDay(e.target.value)} />}
          </Field>
        )}
        {kind === "monthly" && <Field label="Month">{(id) => <Input id={id} type="month" max={cairoToday().slice(0, 7)} value={month} onChange={(e) => setMonth(e.target.value)} />}</Field>}
        {needsTask && (
          <Field label={kind === "project" ? "Project (top-level task)" : "Task"}>
            {(id) => (
              <Select id={id} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">Choose…</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.parent_task_id ? "↳ " : ""}
                    {t.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {filterable && (
          <>
            <Field label="Category (optional)">
              {(id) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All</option>
                  {(data.data?.cats ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Work type (optional)">
              {(id) => (
                <Select id={id} value={workType} onChange={(e) => setWorkType(e.target.value)}>
                  <option value="">All</option>
                  {(Object.keys(WORK_TYPE_LABEL) as TaskWorkType[]).map((w) => (
                    <option key={w} value={w}>
                      {WORK_TYPE_LABEL[w]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Priority (optional)">
              {(id) => (
                <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="">Any</option>
                  {PRIORITY_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" icon={<FilePdf size={18} />} loading={pending} disabled={needsTask && !taskId} onClick={submit}>
          Generate Report
        </Button>
        <p className="text-xs text-ink-soft">The data is frozen at this moment; it then appears at the top of the list. Filters narrow the task figures, not attendance hours.</p>
      </div>
    </Card>
  );
}
