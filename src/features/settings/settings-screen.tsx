"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc, unwrap } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { COMPLEXITY_LABEL, DOW_LABEL, PRIORITY_LABEL, PRIORITY_ORDER } from "@/lib/labels";
import type { Category, PriorityLevel, RecurrenceTemplate, TaskComplexity } from "@/lib/types";
import { ArchiveBox, ArrowCounterClockwise, Bell, Gear, PencilSimple, Plus, Repeat, Stack } from "@/components/icons";
import { TimeSettingsCard } from "./time-settings";
import { EmailSettingsCard } from "./email-settings";

// Non-critical events a person may mute in-app. Critical events (deadline changes, ranking and priority changes,
// revision requests, scope changes by the manager, holds and cancellations) always arrive (Decision 55).
const MUTABLE_EVENTS: Array<[string, string]> = [
  ["task.created", "New tasks"],
  ["task.updated", "Task detail edits"],
  ["task.progress_updated", "Progress updates"],
  ["task.status_changed", "Starts and resumes"],
  ["task.queue_moved", "Planned ↔ Active moves"],
  ["task.completed", "Completions"],
  ["task.reopened", "Reopened tasks"],
  ["deliverable.status_changed", "Deliverable status changes"],
  ["deliverable.extra_added", "Extra deliverables"],
  ["deliverable.evidence_added", "Evidence added"],
  ["task.dependency_added", "Dependencies"],
];

export function SettingsScreen() {
  const { isManager, workspace } = useWorkspace();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-ink-soft">
          {isManager ? "Workspace settings and your personal preferences." : "Your personal preferences. Workspace settings are managed by the manager."}
        </p>
      </div>
      <NotificationPrefs />
      <EmailSettingsCard />
      <TimeSettingsCard />
      <RecurringTasks />
      {isManager && <Categories />}
      <Card>
        <CardHeader icon={<Gear size={20} />} title="Workspace" subtitle={workspace.name} />
        <dl className="grid gap-3 px-5 pb-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-soft">Timezone</dt>
            <dd className="font-medium">{workspace.timezone}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Week</dt>
            <dd className="font-medium">Saturday – Friday</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Working days</dt>
            <dd className="font-medium">Sunday – Thursday</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

function NotificationPrefs() {
  const { profile, refresh } = useWorkspace();
  const { call, pending } = useRpc();
  const [muted, setMuted] = useState<string[]>(profile.preferences?.muted_event_types ?? []);
  const dirty = JSON.stringify([...muted].sort()) !== JSON.stringify([...(profile.preferences?.muted_event_types ?? [])].sort());
  return (
    <Card>
      <CardHeader icon={<Bell size={20} />} title="In-app notifications" subtitle="Important notices always arrive, whatever you mute" />
      <div className="px-5 pb-5">
        <ul className="grid gap-2 sm:grid-cols-2">
          {MUTABLE_EVENTS.map(([key, label]) => (
            <li key={key}>
              <label className="flex items-center gap-3 rounded-[12px] border border-line px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[#5566e0]"
                  checked={!muted.includes(key)}
                  onChange={(e) => setMuted((m) => (e.target.checked ? m.filter((x) => x !== key) : [...m, key]))}
                />
                {label}
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-soft">Muted events are still recorded in task history. Email has its own settings below.</p>
        {dirty && (
          <div className="mt-3">
            <Button
              size="sm"
              variant="primary"
              loading={pending}
              onClick={async () => {
                const r = await call("set_notification_mutes", { p_event_types: muted }, { success: "Preferences saved" });
                if (r.ok) {
                  refresh();
                  window.location.reload();
                }
              }}
            >
              Save preferences
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Categories() {
  const { workspace } = useWorkspace();
  const { call, pending } = useRpc();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Category | null>(null);
  const { data } = useLoad(async () => unwrap(await getBrowserClient().from("categories").select("*").eq("workspace_id", workspace.id).order("sort_order").returns<Category[]>()) ?? [], [workspace.id]);
  return (
    <Card>
      <CardHeader icon={<Stack size={20} />} title="Categories" subtitle="Archived categories stay on existing tasks" />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <ul className="flex flex-col gap-2">
          {(data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-[12px] border border-line px-3 py-2">
              <span className={c.archived_at ? "flex-1 text-sm text-ink-soft line-through" : "flex-1 text-sm font-medium"}>{c.name}</span>
              {c.archived_at ? (
                <IconButton label={`Restore ${c.name}`} disabled={pending} onClick={() => call("update_category", { p_category: c.id, p_archived: false }, { success: "Category restored" })}>
                  <ArrowCounterClockwise size={18} />
                </IconButton>
              ) : (
                <>
                  <IconButton label={`Rename ${c.name}`} onClick={() => setEditing(c)}>
                    <PencilSimple size={18} />
                  </IconButton>
                  <IconButton label={`Archive ${c.name}`} disabled={pending} onClick={() => call("update_category", { p_category: c.id, p_archived: true }, { success: "Category archived" })}>
                    <ArchiveBox size={18} />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await call("create_category", { p_workspace: workspace.id, p_name: name.trim() }, { success: "Category added" });
            if (r.ok) setName("");
          }}
        >
          <Input aria-label="New category name" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" icon={<Plus size={16} />} disabled={!name.trim()} loading={pending}>
            Add
          </Button>
        </form>
      </div>
      {editing && <RenameCategory c={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function RenameCategory({ c, onClose }: { c: Category; onClose: () => void }) {
  const { call, pending } = useRpc();
  const [name, setName] = useState(c.name);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Rename category"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            loading={pending}
            onClick={async () => {
              const r = await call("update_category", { p_category: c.id, p_name: name.trim() }, { success: "Category renamed" });
              if (r.ok) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
    </Dialog>
  );
}

function RecurringTasks() {
  const { workspace, nameOf } = useWorkspace();
  const { call, pending } = useRpc();
  const [editing, setEditing] = useState<RecurrenceTemplate | "new" | null>(null);
  const templates = useLoad(
    async () =>
      unwrap(
        await getBrowserClient()
          .from("recurrence_templates")
          .select("*")
          .eq("workspace_id", workspace.id)
          .is("archived_at", null)
          .order("created_at")
          .returns<RecurrenceTemplate[]>(),
      ) ?? [],
    [workspace.id],
  );
  const cats = useLoad(async () => unwrap(await getBrowserClient().from("categories").select("*").eq("workspace_id", workspace.id).order("sort_order").returns<Category[]>()) ?? [], [workspace.id]);

  return (
    <Card>
      <CardHeader
        icon={<Repeat size={20} />}
        title="Recurring tasks"
        subtitle="Each occurrence becomes its own task in the Planned queue"
        action={
          <Button size="sm" icon={<Plus size={16} />} onClick={() => setEditing("new")}>
            New
          </Button>
        }
      />
      <div className="px-5 pb-5">
        {templates.loading && !templates.data ? (
          <Spinner />
        ) : (templates.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-soft">No recurring tasks yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(templates.data ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-[14px] border border-line px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-ink-soft">
                    {t.frequency === "daily" ? "Daily" : "Weekly"} · {t.days_of_week.map((d) => DOW_LABEL[d]).join(", ")}
                    {t.due_local_time ? ` · due ${t.due_local_time.slice(0, 5)}` : ""} · {nameOf(t.assignee_id)}
                  </p>
                </div>
                {!t.enabled && <Badge>Paused</Badge>}
                <IconButton label={`Edit ${t.title}`} onClick={() => setEditing(t)}>
                  <PencilSimple size={18} />
                </IconButton>
                <IconButton label={`Archive ${t.title}`} disabled={pending} onClick={() => call("archive_recurrence_template", { p_id: t.id }, { success: "Recurring task archived" })}>
                  <ArchiveBox size={18} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && <TemplateDialog template={editing === "new" ? null : editing} categories={cats.data ?? []} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TemplateDialog({ template, categories, onClose }: { template: RecurrenceTemplate | null; categories: Category[]; onClose: () => void }) {
  const { workspace, isManager, employees } = useWorkspace();
  const { call, pending } = useRpc();
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [assignee, setAssignee] = useState(template?.assignee_id ?? employees[0]?.user_id ?? "");
  const [categoryId, setCategoryId] = useState(template?.category_id ?? "");
  const [complexity, setComplexity] = useState<TaskComplexity>(template?.complexity ?? "simple");
  const [priority, setPriority] = useState<PriorityLevel>(template?.priority_level ?? "medium");
  const [frequency, setFrequency] = useState<"daily" | "weekly">(template?.frequency ?? "daily");
  const [days, setDays] = useState<number[]>(template?.days_of_week ?? [0, 1, 2, 3, 4]);
  const [dueTime, setDueTime] = useState(template?.due_local_time?.slice(0, 5) ?? "");
  const [deliverables, setDeliverables] = useState((template?.expected_deliverables ?? []).join("\n"));
  const [enabled, setEnabled] = useState(template?.enabled ?? true);
  const daysValid = frequency === "daily" ? days.length >= 1 : days.length === 1;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={template ? "Edit recurring task" : "New recurring task"}
      description="Occurrences are generated once per day (Cairo). Editing affects future occurrences only."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!title.trim() || !daysValid}
            loading={pending}
            onClick={async () => {
              const r = await call(
                "save_recurrence_template",
                {
                  p_workspace: workspace.id,
                  p_id: template?.id ?? null,
                  p_title: title.trim(),
                  p_description: description,
                  p_assignee: isManager ? assignee : null,
                  p_category: categoryId || null,
                  p_complexity: complexity,
                  p_priority_level: isManager ? priority : "medium",
                  p_frequency: frequency,
                  p_days_of_week: [...days].sort(),
                  p_expected_deliverables: deliverables.split("\n").map((x) => x.trim()).filter(Boolean),
                  p_due_local_time: dueTime || null,
                  p_enabled: enabled,
                },
                { success: "Recurring task saved" },
              );
              if (r.ok) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description">{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        </div>
        {isManager && (
          <Field label="Assigned to">
            {(id) => (
              <Select id={id} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {employees.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profile.display_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Category">
          {(id) => (
            <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories
                .filter((c) => !c.archived_at)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Complexity">
          {(id) => (
            <Select id={id} value={complexity} onChange={(e) => setComplexity(e.target.value as TaskComplexity)}>
              {(Object.keys(COMPLEXITY_LABEL) as TaskComplexity[]).map((c) => (
                <option key={c} value={c}>
                  {COMPLEXITY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {isManager && (
          <Field label="Priority">
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value as PriorityLevel)}>
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Frequency">
          {(id) => (
            <Select
              id={id}
              value={frequency}
              onChange={(e) => {
                const f = e.target.value as "daily" | "weekly";
                setFrequency(f);
                setDays(f === "daily" ? [0, 1, 2, 3, 4] : [0]);
              }}
            >
              <option value="daily">Daily (choose days)</option>
              <option value="weekly">Weekly (one day)</option>
            </Select>
          )}
        </Field>
        <Field label="Due time (Cairo, optional)">{(id) => <Input id={id} type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />}</Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">{frequency === "daily" ? "Days" : "Day of week"}</legend>
          <div className="flex flex-wrap gap-2">
            {DOW_LABEL.map((label, d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDays((xs) => (frequency === "weekly" ? [d] : on ? xs.filter((x) => x !== d) : [...xs, d]))}
                  className={
                    on
                      ? "h-9 rounded-full bg-primary-gradient px-4 text-sm font-medium text-white"
                      : "h-9 rounded-full border border-line px-4 text-sm text-ink-soft hover:text-ink"
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          {!daysValid && <p className="mt-1 text-xs text-danger">Choose {frequency === "daily" ? "at least one day" : "one day"}.</p>}
        </fieldset>
        <div className="sm:col-span-2">
          <Field label="Expected deliverables (one per line)">{(id) => <Textarea id={id} value={deliverables} onChange={(e) => setDeliverables(e.target.value)} />}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="size-4 accent-[#5566e0]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Generating occurrences
        </label>
      </div>
    </Dialog>
  );
}
