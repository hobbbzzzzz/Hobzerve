"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useWorkspace } from "@/components/workspace-provider";
import { useRpc } from "@/lib/client/hooks";
import { formatDateTime } from "@/lib/dates";
import { DELIVERABLE_STATUS_LABEL } from "@/lib/labels";
import type { Deliverable, DeliverableEvidence, DeliverableStatus, ScopeCycle, Task } from "@/lib/types";
import { ArchiveBox, ArrowCounterClockwise, CheckSquare, LinkIcon, Note, PencilSimple, Plus } from "@/components/icons";

const STATUSES: DeliverableStatus[] = ["not_started", "in_progress", "delivered", "not_applicable"];

export function DeliverablesPanel({
  task,
  deliverables,
  evidence,
  scopeCycles,
  locked,
  compact,
}: {
  task: Task;
  deliverables: Deliverable[];
  evidence: DeliverableEvidence[];
  scopeCycles: ScopeCycle[];
  locked?: boolean;
  compact?: boolean;
}) {
  const scopeEditable = !locked && !task.archived_at && task.status !== "completed" && task.status !== "cancelled";
  const current = deliverables.filter((d) => d.scope_cycle_id === task.current_scope_cycle_id && !d.archived_at);
  const expected = current.filter((d) => d.kind === "expected");
  const extra = current.filter((d) => d.kind === "extra");
  const earlier = deliverables.filter((d) => d.scope_cycle_id !== task.current_scope_cycle_id && !d.archived_at);
  const archived = deliverables.filter((d) => d.archived_at);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Group title="Expected" empty="No expected deliverables yet.">
        {expected.map((d) => (
          <DeliverableRow key={d.id} d={d} task={task} evidence={evidence.filter((e) => e.deliverable_id === d.id)} editable={scopeEditable} compact={compact} />
        ))}
      </Group>
      {(extra.length > 0 || !compact) && (
        <Group title="Extra Deliverables" empty="Nothing extra yet. Extras are counted by who initiated them.">
          {extra.map((d) => (
            <DeliverableRow key={d.id} d={d} task={task} evidence={evidence.filter((e) => e.deliverable_id === d.id)} editable={scopeEditable} compact={compact} />
          ))}
        </Group>
      )}
      {scopeEditable ? (
        <div>
          <Button size="sm" icon={<Plus size={16} />} onClick={() => setAdding(true)}>
            Add Deliverable
          </Button>
        </div>
      ) : (
        task.status === "completed" && <p className="text-xs text-ink-soft">Scope is locked while the task is completed. Reopen it to change deliverables.</p>
      )}
      {!compact && earlier.length > 0 && (
        <Group title="Earlier Scope Cycles" empty="">
          {earlier.map((d) => {
            const cycle = scopeCycles.find((c) => c.id === d.scope_cycle_id);
            return (
              <DeliverableRow
                key={d.id}
                d={d}
                task={task}
                evidence={evidence.filter((e) => e.deliverable_id === d.id)}
                editable={false}
                note={cycle ? `Cycle ${cycle.sequence} (${cycle.type})` : undefined}
              />
            );
          })}
        </Group>
      )}
      {!compact && archived.length > 0 && (
        <Group title="Archived" empty="">
          {archived.map((d) => (
            <DeliverableRow key={d.id} d={d} task={task} evidence={[]} editable={scopeEditable} />
          ))}
        </Group>
      )}
      <AddDeliverableDialog open={adding} onClose={() => setAdding(false)} task={task} />
    </div>
  );
}

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">{title}</h3>
      {items.length ? <ul className="flex flex-col gap-2">{children}</ul> : empty ? <p className="text-sm text-ink-soft">{empty}</p> : null}
    </section>
  );
}

function DeliverableRow({
  d,
  task,
  evidence,
  editable,
  compact,
  note,
}: {
  d: Deliverable;
  task: Task;
  evidence: DeliverableEvidence[];
  editable: boolean;
  compact?: boolean;
  note?: string;
}) {
  const { userId, nameOf } = useWorkspace();
  const { call, pending } = useRpc();
  const [editing, setEditing] = useState(false);
  const [addingEvidence, setAddingEvidence] = useState(false);
  const canSetStatus = editable && task.assignee_id === userId && !d.archived_at;
  const statusTone = d.status === "delivered" ? "success" : d.status === "not_applicable" ? "neutral" : d.status === "in_progress" ? "primary" : "neutral";

  return (
    <li className="rounded-[14px] border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        <CheckSquare size={18} className={d.status === "delivered" ? "mt-0.5 text-success" : "mt-0.5 text-ink-soft/50"} />
        <div className="min-w-0 flex-1">
          <p className={d.archived_at ? "text-sm text-ink-soft line-through" : "text-sm font-medium"}>{d.title}</p>
          {!compact && d.description && <p className="mt-0.5 text-sm text-ink-soft">{d.description}</p>}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {d.origin && <Badge tone="lavender">{d.origin === "self_initiated" ? "Self-initiated" : "Manager-requested"}</Badge>}
            {note && <Badge>{note}</Badge>}
            {d.delivered_at && <Badge tone="success">Delivered {formatDateTime(d.delivered_at)}</Badge>}
          </div>
        </div>
        {canSetStatus ? (
          <Select
            aria-label={`Status of ${d.title}`}
            className="h-9 w-36 shrink-0"
            value={d.status}
            disabled={pending}
            onChange={(e) =>
              call("set_deliverable_status", { p_deliverable: d.id, p_expected_version: d.version, p_status: e.target.value as DeliverableStatus })
            }
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {DELIVERABLE_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={statusTone}>{DELIVERABLE_STATUS_LABEL[d.status]}</Badge>
        )}
      </div>

      {!compact && evidence.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-2">
          {evidence.map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-sm">
              {e.url ? <LinkIcon size={16} className="mt-0.5 text-primary-strong" /> : <Note size={16} className="mt-0.5 text-ink-soft" />}
              <div className="min-w-0">
                {e.url && (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="break-all text-primary-strong underline-offset-2 hover:underline">
                    {e.url}
                  </a>
                )}
                {e.note && <p className="text-ink-soft">{e.note}</p>}
                <p className="text-xs text-ink-soft">
                  {nameOf(e.added_by)} · {formatDateTime(e.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!compact && !d.archived_at && (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" icon={<LinkIcon size={16} />} onClick={() => setAddingEvidence(true)}>
            Add Evidence
          </Button>
          {editable && (
            <>
              <IconButton label={`Edit ${d.title}`} onClick={() => setEditing(true)}>
                <PencilSimple size={18} />
              </IconButton>
              <IconButton
                label={`Archive ${d.title}`}
                disabled={pending}
                onClick={() => call("set_deliverable_archived", { p_deliverable: d.id, p_archived: true }, { success: "Deliverable archived" })}
              >
                <ArchiveBox size={18} />
              </IconButton>
            </>
          )}
        </div>
      )}
      {!compact && d.archived_at && editable && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowCounterClockwise size={16} />}
            onClick={() => call("set_deliverable_archived", { p_deliverable: d.id, p_archived: false }, { success: "Deliverable restored" })}
          >
            Restore
          </Button>
        </div>
      )}

      <EditDeliverableDialog open={editing} onClose={() => setEditing(false)} d={d} />
      <EvidenceDialog open={addingEvidence} onClose={() => setAddingEvidence(false)} d={d} />
    </li>
  );
}

function AddDeliverableDialog({ open, onClose, task }: { open: boolean; onClose: () => void; task: Task }) {
  const { userId } = useWorkspace();
  const { call, pending } = useRpc();
  const [kind, setKind] = useState<"expected" | "extra">("expected");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add Deliverable"
      description={
        task.status === "in_progress" || task.status === "on_hold"
          ? "Adding an expected deliverable during work is recorded as a scope change and notifies the other person."
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            loading={pending}
            onClick={async () => {
              const r = await call("add_deliverable", { p_task: task.id, p_kind: kind, p_title: title.trim(), p_description: description }, { success: "Deliverable added" });
              if (r.ok) {
                setTitle("");
                setDescription("");
                onClose();
              }
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Type"
          hint={
            kind === "extra"
              ? `Recorded as ${task.assignee_id === userId ? "self-initiated" : "manager-requested"}.`
              : "Part of the agreed scope; checked at completion."
          }
        >
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as "expected" | "extra")}>
              <option value="expected">Expected deliverable</option>
              <option value="extra">Extra deliverable</option>
            </Select>
          )}
        </Field>
        <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />}</Field>
        <Field label="Description (optional)">{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function EditDeliverableDialog({ open, onClose, d }: { open: boolean; onClose: () => void; d: Deliverable }) {
  const { call, pending } = useRpc();
  const [title, setTitle] = useState(d.title);
  const [description, setDescription] = useState(d.description);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit Deliverable"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            loading={pending}
            onClick={async () => {
              const r = await call(
                "update_deliverable",
                { p_deliverable: d.id, p_expected_version: d.version, p_title: title.trim(), p_description: description },
                { success: "Deliverable saved" },
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
        <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Description">{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function EvidenceDialog({ open, onClose, d }: { open: boolean; onClose: () => void; d: Deliverable }) {
  const { call, pending } = useRpc();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const urlInvalid = url.trim() !== "" && !/^https?:\/\//i.test(url.trim());
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add Evidence"
      description="A link (document, ticket, file share) and/or a note. File uploads arrive in a later stage."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="primary"
            disabled={(!url.trim() && !note.trim()) || urlInvalid}
            loading={pending}
            onClick={async () => {
              const r = await call("add_deliverable_evidence", { p_deliverable: d.id, p_url: url.trim() || null, p_note: note.trim() || null }, { success: "Evidence added" });
              if (r.ok) {
                setUrl("");
                setNote("");
                onClose();
              }
            }}
          >
            Add Evidence
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Link" error={urlInvalid ? "Links must start with http:// or https://" : undefined}>
          {(id) => <Input id={id} type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />}
        </Field>
        <Field label="Note">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
