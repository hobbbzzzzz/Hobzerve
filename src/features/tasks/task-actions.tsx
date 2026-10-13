"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useWorkspace } from "@/components/workspace-provider";
import { useRpc } from "@/lib/client/hooks";
import { cairoLocalToIso, cairoToday, formatDateTime, isoToCairoLocal } from "@/lib/dates";
import { DELIVERABLE_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_ORDER, isOpenStatus } from "@/lib/labels";
import type { Deliverable, PriorityLevel, Task } from "@/lib/types";
import {
  ArchiveBox,
  ArrowCounterClockwise,
  CalendarBlank,
  CheckCircle,
  HandPalm,
  Lock,
  PauseCircle,
  PlayCircle,
  Prohibit,
  Rocket,
  Stack,
  Tray,
} from "@/components/icons";

type DialogKind = null | "hold" | "cancel" | "deadline" | "complete" | "reopen" | "request" | "archive";

/** Every action a person can take on a task, filtered by role and state. Server rules still decide. */
export function TaskActionBar({
  task,
  parent,
  deliverables,
  subtasks,
  layout = "wrap",
}: {
  task: Task;
  parent?: Task | null;
  deliverables: Deliverable[];
  subtasks: Task[];
  layout?: "wrap" | "stack";
}) {
  const { userId, isManager } = useWorkspace();
  const { call, pending } = useRpc();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const isAssignee = task.assignee_id === userId;
  const locked = !!parent && parent.status === "completed";
  const archived = !!task.archived_at;
  const v = task.record_version;

  const status = (action: string, reason?: string, success?: string) =>
    call("change_task_status", { p_task: task.id, p_expected_version: v, p_action: action, p_reason: reason ?? null }, { success });

  if (archived) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-ink-soft">This task is archived.</p>
        <Button
          size="sm"
          icon={<ArrowCounterClockwise size={16} />}
          loading={pending}
          onClick={() => call("set_task_archived", { p_task: task.id, p_expected_version: v, p_archived: false }, { success: "Task restored" })}
        >
          Restore
        </Button>
      </div>
    );
  }

  return (
    <>
      {locked && (
        <p className="mb-3 flex items-start gap-2 rounded-[14px] bg-[#fbf0e2] px-3 py-2 text-sm text-warning">
          <Lock size={18} className="mt-0.5 shrink-0" />
          The parent task is completed. Work on this subtask resumes only after the employee reopens the parent.
        </p>
      )}
      <div className={layout === "stack" ? "flex flex-col gap-2" : "flex flex-wrap gap-2"}>
        {isAssignee && !locked && (
          <>
            {task.status === "not_started" && (
              <Button size="sm" variant="primary" icon={<PlayCircle size={16} />} loading={pending} onClick={() => status("start", undefined, "Task started")}>
                Start
              </Button>
            )}
            {task.status === "in_progress" && (
              <Button size="sm" icon={<PauseCircle size={16} />} onClick={() => setDialog("hold")}>
                Put on hold
              </Button>
            )}
            {task.status === "on_hold" && (
              <Button size="sm" variant="primary" icon={<PlayCircle size={16} />} loading={pending} onClick={() => status("resume", undefined, "Task resumed")}>
                Resume
              </Button>
            )}
            {(task.status === "not_started" || task.status === "in_progress") && (
              <Button size="sm" variant={task.status === "in_progress" ? "primary" : "secondary"} icon={<CheckCircle size={16} />} onClick={() => setDialog("complete")}>
                Complete
              </Button>
            )}
            {task.status === "completed" && (
              <Button size="sm" icon={<ArrowCounterClockwise size={16} />} onClick={() => setDialog("reopen")}>
                Reopen
              </Button>
            )}
            {task.status === "cancelled" && (
              <Button size="sm" icon={<ArrowCounterClockwise size={16} />} loading={pending} onClick={() => status("reactivate", undefined, "Task reactivated")}>
                Reactivate
              </Button>
            )}
            {!task.parent_task_id && isOpenStatus(task.status) && (
              <Button
                size="sm"
                icon={task.queue === "planned" ? <Rocket size={16} /> : <Tray size={16} />}
                loading={pending}
                onClick={() =>
                  call(
                    "move_task_queue",
                    { p_task: task.id, p_expected_version: v, p_queue: task.queue === "planned" ? "active" : "planned" },
                    { success: task.queue === "planned" ? "Moved to Active" : "Moved to Planned" },
                  )
                }
              >
                {task.queue === "planned" ? "Move to Active" : "Move to Planned"}
              </Button>
            )}
            {isOpenStatus(task.status) && (
              <Button size="sm" variant="ghost" icon={<Prohibit size={16} />} onClick={() => setDialog("cancel")}>
                Cancel task
              </Button>
            )}
          </>
        )}

        {task.status !== "completed" && (
          <Button size="sm" icon={<CalendarBlank size={16} />} onClick={() => setDialog("deadline")}>
            {task.current_due_at ? "Change deadline" : "Set deadline"}
          </Button>
        )}

        {isManager && !task.parent_task_id && <PrioritySelect task={task} />}

        {(isManager || isAssignee) && (
          <Button size="sm" variant="ghost" icon={<HandPalm size={16} />} onClick={() => setDialog("request")}>
            {isManager ? "Request…" : "Propose priority"}
          </Button>
        )}

        <Button size="sm" variant="ghost" icon={<ArchiveBox size={16} />} onClick={() => setDialog("archive")}>
          Archive
        </Button>
      </div>

      <ReasonDialog
        open={dialog === "hold"}
        onClose={() => setDialog(null)}
        title="Put task on hold"
        description="Progress freezes while on hold and the hold duration is logged. The deadline does not move."
        label="Why is it on hold?"
        confirm="Put on hold"
        onSubmit={async (r) => (await status("hold", r, "Task on hold")).ok}
      />
      <ReasonDialog
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        title="Cancel task"
        description="Cancelled tasks keep their full history and can be reactivated later."
        label="Why is it being cancelled?"
        confirm="Cancel task"
        danger
        onSubmit={async (r) => (await status("cancel", r, "Task cancelled")).ok}
      />
      <ReasonDialog
        open={dialog === "archive"}
        onClose={() => setDialog(null)}
        title="Archive task"
        description="Archived tasks disappear from boards but stay in history and can be restored."
        label="Reason (optional)"
        optional
        confirm="Archive"
        onSubmit={async (r) =>
          (await call("set_task_archived", { p_task: task.id, p_expected_version: v, p_archived: true, p_reason: r || null }, { success: "Task archived" })).ok
        }
      />
      <DeadlineDialog open={dialog === "deadline"} onClose={() => setDialog(null)} task={task} />
      <CompleteDialog open={dialog === "complete"} onClose={() => setDialog(null)} task={task} deliverables={deliverables} subtasks={subtasks} />
      <ReopenDialog open={dialog === "reopen"} onClose={() => setDialog(null)} task={task} />
      <RequestDialog open={dialog === "request"} onClose={() => setDialog(null)} task={task} />
    </>
  );
}

function PrioritySelect({ task }: { task: Task }) {
  const { call, pending } = useRpc();
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="sr-only">Priority level</span>
      <Select
        aria-label="Priority level"
        className="h-9 w-36"
        value={task.priority_level}
        disabled={pending}
        onChange={(e) => call("set_priority_level", { p_task: task.id, p_level: e.target.value as PriorityLevel }, { success: "Priority updated" })}
      >
        {PRIORITY_ORDER.map((p) => (
          <option key={p} value={p}>
            Priority: {PRIORITY_LABEL[p]}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  label,
  confirm,
  onSubmit,
  danger,
  optional,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  label: string;
  confirm: string;
  onSubmit: (reason: string) => Promise<boolean>;
  danger?: boolean;
  optional?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = optional || reason.trim().length >= 3;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={!valid}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onSubmit(reason.trim());
              setBusy(false);
              if (ok) {
                setReason("");
                onClose();
              }
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <Field label={label} hint={optional ? undefined : "At least 3 characters. Saved in the task history."}>
        {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
      </Field>
    </Dialog>
  );
}

function DeadlineDialog({ open, onClose, task }: { open: boolean; onClose: () => void; task: Task }) {
  const { call, pending } = useRpc();
  const initial = task.current_due_at ? isoToCairoLocal(task.current_due_at) : { date: cairoToday(), time: "17:00" };
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [clear, setClear] = useState(false);
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 3 && (clear || !!date);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={task.current_due_at ? "Change deadline" : "Set deadline"}
      description={
        <>
          Times are Cairo time. Current: <span className="font-medium text-ink">{formatDateTime(task.current_due_at)}</span>. Every change is kept in
          the deadline history.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={pending}
            onClick={async () => {
              const r = await call(
                "change_deadline",
                {
                  p_task: task.id,
                  p_expected_version: task.record_version,
                  p_due_at: clear ? null : cairoLocalToIso(date, time || "23:59"),
                  p_reason: reason.trim(),
                },
                { success: "Deadline updated" },
              );
              if (r.ok) {
                setReason("");
                onClose();
              }
            }}
          >
            Save deadline
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} disabled={clear} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Time (Cairo)">{(id) => <Input id={id} type="time" value={time} disabled={clear} onChange={(e) => setTime(e.target.value)} />}</Field>
        </div>
        {task.current_due_at && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[#5566e0]" checked={clear} onChange={(e) => setClear(e.target.checked)} />
            Remove the deadline
          </label>
        )}
        <Field label="Reason for the change" hint="Required. The other person is notified.">
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

function CompleteDialog({
  open,
  onClose,
  task,
  deliverables,
  subtasks,
}: {
  open: boolean;
  onClose: () => void;
  task: Task;
  deliverables: Deliverable[];
  subtasks: Task[];
}) {
  const { call, pending } = useRpc();
  const missing = deliverables.filter(
    (d) => d.kind === "expected" && !d.archived_at && d.scope_cycle_id === task.current_scope_cycle_id && d.status !== "delivered" && d.status !== "not_applicable",
  );
  const openSubs = subtasks.filter((s) => !s.archived_at && s.status !== "completed" && s.status !== "cancelled");
  const [dReasons, setDReasons] = useState<Record<string, string>>({});
  const [sReasons, setSReasons] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const allGiven = missing.every((d) => (dReasons[d.id] ?? "").trim().length >= 3) && openSubs.every((s) => (sReasons[s.id] ?? "").trim().length >= 3);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Complete task"
      description="Completion is immediate — no manager approval. A snapshot of deliverables is saved and can't be edited later."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="primary"
            icon={<CheckCircle size={18} />}
            disabled={!allGiven}
            loading={pending}
            onClick={async () => {
              const r = await call(
                "complete_task",
                {
                  p_task: task.id,
                  p_expected_version: task.record_version,
                  p_missing_reasons: Object.fromEntries(missing.map((d) => [d.id, (dReasons[d.id] ?? "").trim()])),
                  p_subtask_reasons: Object.fromEntries(openSubs.map((s) => [s.id, (sReasons[s.id] ?? "").trim()])),
                  p_note: note.trim() || null,
                },
                { success: "Task completed" },
              );
              if (r.ok) onClose();
            }}
          >
            Complete now
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Expected deliverables</h3>
          {deliverables.filter((d) => d.kind === "expected" && !d.archived_at && d.scope_cycle_id === task.current_scope_cycle_id).length === 0 ? (
            <p className="text-sm text-ink-soft">No expected deliverables in the current scope.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {deliverables
                .filter((d) => d.kind === "expected" && !d.archived_at && d.scope_cycle_id === task.current_scope_cycle_id)
                .map((d) => {
                  const isMissing = missing.some((m) => m.id === d.id);
                  return (
                    <li key={d.id} className="rounded-[14px] border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{d.title}</span>
                        <span className={isMissing ? "text-xs font-medium text-warning" : "text-xs font-medium text-success"}>
                          {DELIVERABLE_STATUS_LABEL[d.status]}
                        </span>
                      </div>
                      {isMissing && (
                        <div className="mt-2">
                          <Field label={`Why is "${d.title}" not delivered?`}>
                            {(id) => (
                              <Input id={id} value={dReasons[d.id] ?? ""} onChange={(e) => setDReasons((x) => ({ ...x, [d.id]: e.target.value }))} />
                            )}
                          </Field>
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
        {openSubs.length > 0 && (
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Stack size={16} /> Unfinished subtasks
            </h3>
            <p className="mb-2 text-xs text-ink-soft">
              After completion these subtasks stay paused until you reopen this task.
            </p>
            <ul className="flex flex-col gap-2">
              {openSubs.map((s) => (
                <li key={s.id} className="rounded-[14px] border border-line p-3">
                  <Field label={`Why is "${s.title}" unfinished?`}>
                    {(id) => <Input id={id} value={sReasons[s.id] ?? ""} onChange={(e) => setSReasons((x) => ({ ...x, [s.id]: e.target.value }))} />}
                  </Field>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Field label="Completion note (optional)">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {task.manual_progress < 100 && (
          <p className="text-xs text-ink-soft">Progress is at {task.manual_progress}%. It is saved as-is in the completion snapshot.</p>
        )}
      </div>
    </Dialog>
  );
}

function ReopenDialog({ open, onClose, task }: { open: boolean; onClose: () => void; task: Task }) {
  const { call, pending } = useRpc();
  const [mode, setMode] = useState<"revision" | "additional_scope">("revision");
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reopen task"
      description="The original completion still counts once. Reopening unlocks the deadline and subtasks."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="primary"
            disabled={reason.trim().length < 3}
            loading={pending}
            onClick={async () => {
              const r = await call(
                "reopen_task",
                { p_task: task.id, p_expected_version: task.record_version, p_mode: mode, p_reason: reason.trim() },
                { success: "Task reopened" },
              );
              if (r.ok) {
                setReason("");
                onClose();
              }
            }}
          >
            Reopen
          </Button>
        </>
      }
    >
      <fieldset className="mb-4 flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">What kind of work is this?</legend>
        {(
          [
            ["revision", "Revision", "Fixing or adjusting the same scope (a revision round)."],
            ["additional_scope", "Additional scope", "New work on top of what was delivered (a new scope cycle)."],
          ] as const
        ).map(([value, title, hint]) => (
          <label key={value} className="flex cursor-pointer items-start gap-3 rounded-[14px] border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-surface-alt">
            <input type="radio" name="reopen-mode" className="mt-1 size-4 accent-[#5566e0]" checked={mode === value} onChange={() => setMode(value)} />
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="block text-xs text-ink-soft">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Reason">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </Dialog>
  );
}

function RequestDialog({ open, onClose, task }: { open: boolean; onClose: () => void; task: Task }) {
  const { isManager } = useWorkspace();
  const { call, pending } = useRpc();
  const kinds = isManager
    ? ([
        ...(task.status === "completed" ? [["revision", "Request a revision"]] : []),
        ["progress_update", "Request a progress update"],
        ["status_change", "Request a status change"],
      ] as Array<[string, string]>)
    : ([["priority_change", "Propose a priority change"]] as Array<[string, string]>);
  const [kind, setKind] = useState(kinds[0]![0]);
  const [note, setNote] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isManager ? "Send a request" : "Propose a priority change"}
      description={
        isManager
          ? "Requests notify the employee. They don't change the task — the employee stays in control of its status."
          : "The manager decides priority and rank. Your proposal is sent as a notification."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="primary"
            disabled={note.trim().length < 3}
            loading={pending}
            onClick={async () => {
              const r = await call("request_task_action", { p_task: task.id, p_kind: kind, p_note: note.trim() }, { success: "Request sent" });
              if (r.ok) {
                setNote("");
                onClose();
              }
            }}
          >
            Send
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {kinds.length > 1 && (
          <Field label="Request">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
                {kinds.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Note">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

/** Employee-only progress slider (Decision 67). */
export function ProgressControl({ task, locked }: { task: Task; locked?: boolean }) {
  const { userId } = useWorkspace();
  const { call, pending } = useRpc();
  const [value, setValue] = useState(task.manual_progress);
  const [prevVersion, setPrevVersion] = useState(task.record_version);
  if (prevVersion !== task.record_version) {
    setPrevVersion(task.record_version);
    setValue(task.manual_progress);
  }
  const canEdit = task.assignee_id === userId && task.status === "in_progress" && !locked && !task.archived_at;
  const hint =
    task.status === "on_hold"
      ? "Frozen while on hold."
      : task.status === "not_started"
        ? "Start the task to update progress."
        : task.assignee_id !== userId
          ? "Only the employee updates progress."
          : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={`progress-${task.id}`} className="text-sm font-medium">
          Progress
        </label>
        <span className="tabular text-sm font-semibold text-primary-strong">{value}%</span>
      </div>
      <input
        id={`progress-${task.id}`}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={!canEdit || pending}
        onChange={(e) => setValue(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-[#5566e0] disabled:cursor-not-allowed"
      />
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
      {canEdit && value !== task.manual_progress && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            loading={pending}
            onClick={() => call("set_progress", { p_task: task.id, p_expected_version: task.record_version, p_progress: value }, { success: "Progress saved" })}
          >
            Save progress
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setValue(task.manual_progress)}>
            Reset
          </Button>
        </div>
      )}
    </div>
  );
}
