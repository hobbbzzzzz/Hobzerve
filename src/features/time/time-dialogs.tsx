"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useWorkspace } from "@/components/workspace-provider";
import { useRpc } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { cairoLocalToIso, cairoToday, formatDuration, formatTime, isoToCairoLocal } from "@/lib/dates";
import type { ActivityKind, ActivitySegment, AttendanceSession, Task } from "@/lib/types";
import { ActivityPicker, type ActivityChoice } from "./activity-picker";
import { activityTitle } from "./live";

function useInstant(initialIso: string | null, fallbackTime = "09:00") {
  const init = initialIso ? isoToCairoLocal(initialIso) : { date: cairoToday(), time: fallbackTime };
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  return { date, setDate, time, setTime, iso: date && time ? cairoLocalToIso(date, time) : null };
}

function InstantFields({ label, v }: { label: string; v: ReturnType<typeof useInstant> }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={`${label} date`}>{(id) => <Input id={id} type="date" value={v.date} onChange={(e) => v.setDate(e.target.value)} />}</Field>
      <Field label={`${label} time (Cairo)`}>{(id) => <Input id={id} type="time" value={v.time} onChange={(e) => v.setTime(e.target.value)} />}</Field>
    </div>
  );
}

function ActivityField({ value, onChange }: { value: ActivityChoice; onChange: (c: ActivityChoice) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Activity</span>
      <button type="button" onClick={() => setOpen(true)} className="flex h-11 items-center justify-between rounded-[12px] border border-line px-3 text-left text-sm hover:bg-surface-alt">
        <span className={value.kind === "unassigned" ? "text-warning" : undefined}>{value.label}</span>
        <span className="text-xs font-medium text-primary-strong">Change</span>
      </button>
      <ActivityPicker
        open={open}
        onClose={() => setOpen(false)}
        title="Choose the Activity"
        onPick={(c) => {
          onChange(c);
          setOpen(false);
        }}
      />
    </div>
  );
}

/** Add a backdated session or correct an existing one (Decision 28). Employee only; every change is audited. */
export function SessionDialog({ open, onClose, session }: { open: boolean; onClose: () => void; session?: AttendanceSession }) {
  const { workspace } = useWorkspace();
  const { call, pending } = useRpc();
  const start = useInstant(session?.started_at ?? null, "09:00");
  const end = useInstant(
    session?.ended_at ??
      (session ? new Date(Math.min(Date.now(), Date.parse(session.started_at) + 8 * 3600 * 1000)).toISOString() : null),
    "17:00",
  );
  const [reason, setReason] = useState("");
  const [activity, setActivity] = useState<ActivityChoice>({ kind: "unassigned", label: "Unassigned" });
  const editing = !!session;
  const wasOpen = editing && !session.ended_at;
  const valid = !!start.iso && !!end.iso && Date.parse(end.iso) > Date.parse(start.iso) && reason.trim().length >= 3;
  const duration = start.iso && end.iso ? (Date.parse(end.iso) - Date.parse(start.iso)) / 1000 : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? (wasOpen ? "End This Session" : "Correct Session Times") : "Add a Past Session"}
      description={
        editing
          ? "Corrections are kept in the history. If this week is already closed, the difference is posted as an adjustment to the current week — the closed week itself never changes."
          : "For time you forgot to clock. If its week is already closed, the hours are posted as an adjustment to the current week."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={pending}
            onClick={async () => {
              const r = editing
                ? await call(
                    "correct_attendance",
                    { p_session: session.id, p_expected_version: session.version, p_started_at: start.iso, p_ended_at: end.iso, p_reason: reason.trim() },
                    { success: "Session corrected" },
                  )
                : await call(
                    "add_attendance_session",
                    {
                      p_workspace: workspace.id,
                      p_started_at: start.iso,
                      p_ended_at: end.iso,
                      p_reason: reason.trim(),
                      p_kind: activity.kind,
                      p_task: activity.taskId ?? null,
                      p_general_type: activity.generalType ?? null,
                    },
                    { success: "Session added" },
                  );
              if (r.ok) {
                setReason("");
                onClose();
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <InstantFields label="Start" v={start} />
        <InstantFields label="End" v={end} />
        {duration > 0 && <p className="tabular text-sm text-ink-soft">Duration: {formatDuration(duration)}</p>}
        {!editing && <ActivityField value={activity} onChange={setActivity} />}
        <Field label="Reason" hint="Required. The manager is notified.">
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

export function RemoveSessionDialog({ open, onClose, session }: { open: boolean; onClose: () => void; session: AttendanceSession }) {
  const { call, pending } = useRpc();
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Remove Session"
      description={`${formatTime(session.started_at)}–${formatTime(session.ended_at)}. The session stays in the audit history but no longer counts. Closed weeks get an adjustment instead of changing.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={pending}
            onClick={async () => {
              const r = await call("void_attendance_session", { p_session: session.id, p_expected_version: session.version, p_reason: reason.trim() }, { success: "Session removed" });
              if (r.ok) onClose();
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <Field label="Reason">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </Dialog>
  );
}

/** Re-label all or part of an activity block at the real transition time (Decisions 79, 102). */
export function RelabelDialog({
  open,
  onClose,
  segment,
  tasksById,
}: {
  open: boolean;
  onClose: () => void;
  segment: ActivitySegment;
  tasksById: Map<string, { title: string; parent_task_id: string | null }>;
}) {
  const { call, pending } = useRpc();
  const from = useInstant(segment.started_at);
  const to = useInstant(segment.ended_at ?? new Date().toISOString());
  const [whole, setWhole] = useState(true);
  const [reason, setReason] = useState("");
  const [activity, setActivity] = useState<ActivityChoice | null>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Re-Label Activity"
      description={`${activityTitle(segment, tasksById)}, ${formatTime(segment.started_at)}–${segment.ended_at ? formatTime(segment.ended_at) : "now"}. Attendance hours don't change; only what the time counts toward.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!activity || reason.trim().length < 3}
            loading={pending}
            onClick={async () => {
              const r = await call(
                "reclassify_segment",
                {
                  p_segment: segment.id,
                  p_from: whole ? null : from.iso,
                  p_to: whole ? null : to.iso,
                  p_kind: activity!.kind as ActivityKind,
                  p_task: activity!.taskId ?? null,
                  p_general_type: activity!.generalType ?? null,
                  p_reason: reason.trim(),
                },
                { success: "Activity re-labelled" },
              );
              if (r.ok) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ActivityField value={activity ?? { kind: "unassigned", label: "Choose…" }} onChange={setActivity} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
          The whole block
        </label>
        {!whole && (
          <>
            <InstantFields label="From" v={from} />
            <InstantFields label="To" v={to} />
          </>
        )}
        <Field label="Reason">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

/** Manual task time, independent of attendance (Decisions 29, 41). Overlaps need confirmation. */
export function ManualTimeDialog({
  open,
  onClose,
  tasks,
  defaultTaskId,
}: {
  open: boolean;
  onClose: () => void;
  tasks: Array<Pick<Task, "id" | "title" | "parent_task_id">>;
  defaultTaskId?: string;
}) {
  const { refresh } = useWorkspace();
  const toast = useToast();
  const [taskId, setTaskId] = useState(defaultTaskId ?? tasks[0]?.id ?? "");
  const start = useInstant(null, "09:00");
  const end = useInstant(null, "10:00");
  const [note, setNote] = useState("");
  const [overlap, setOverlap] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = !!taskId && !!start.iso && !!end.iso && Date.parse(end.iso) > Date.parse(start.iso);

  async function save(ack: boolean) {
    setBusy(true);
    const { error } = await getBrowserClient().rpc("add_manual_time", {
      p_task: taskId,
      p_started_at: start.iso,
      p_ended_at: end.iso,
      p_note: note.trim() || null,
      p_acknowledge_overlap: ack,
    });
    setBusy(false);
    if (error?.details === "overlap") {
      setOverlap(true);
      return;
    }
    if (error) {
      toast("error", friendlyError(error));
      return;
    }
    toast("success", "Time added");
    setOverlap(false);
    setNote("");
    refresh();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add Task Time"
      description="Task time is for analysis only — payable hours come from attendance."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {overlap ? (
            <Button variant="primary" loading={busy} onClick={() => save(true)}>
              Keep Both
            </Button>
          ) : (
            <Button variant="primary" disabled={!valid} loading={busy} onClick={() => save(false)}>
              Add
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Task">
          {(id) => (
            <Select id={id} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.parent_task_id ? "↳ " : ""}
                  {t.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <InstantFields label="Start" v={start} />
        <InstantFields label="End" v={end} />
        <Field label="Note (optional)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {overlap && (
          <p role="alert" className="rounded-[14px] bg-warning-tint px-3 py-2 text-sm text-warning">
            This overlaps task time you already recorded. Keeping both is allowed — reports show the raw total and the de-duplicated total separately.
          </p>
        )}
      </div>
    </Dialog>
  );
}
