"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useWorkspace } from "@/components/workspace-provider";
import { useRpc } from "@/lib/client/hooks";
import { cairoLocalToIso } from "@/lib/dates";
import { COMPLEXITY_LABEL, PRIORITY_LABEL, PRIORITY_ORDER, WORK_TYPE_LABEL } from "@/lib/labels";
import type { Category, PriorityLevel, Task, TaskComplexity, TaskQueue, TaskWorkType } from "@/lib/types";

function parseLabels(s: string): string[] {
  return [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function NewTaskDialog({
  open,
  onClose,
  categories,
  parent,
  defaultQueue = "planned",
}: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  parent?: Task;
  defaultQueue?: TaskQueue;
}) {
  const router = useRouter();
  const { workspace, isManager, employees } = useWorkspace();
  const { call, pending } = useRpc();
  const [requestId, setRequestId] = useState(newRequestId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(parent?.category_id ?? "");
  const [workType, setWorkType] = useState<TaskWorkType>(parent ? "one_off" : "one_off");
  const [complexity, setComplexity] = useState<TaskComplexity>("moderate");
  const [estimateHours, setEstimateHours] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("17:00");
  const [queue, setQueue] = useState<TaskQueue>(defaultQueue);
  const [priority, setPriority] = useState<PriorityLevel>("medium");
  const [assignee, setAssignee] = useState(parent?.assignee_id ?? employees[0]?.user_id ?? "");
  const [deliverables, setDeliverables] = useState("");
  const [labels, setLabels] = useState("");
  const activeCategories = useMemo(() => categories.filter((c) => !c.archived_at), [categories]);

  function reset() {
    setTitle("");
    setDescription("");
    setEstimateHours("");
    setDueDate("");
    setDeliverables("");
    setLabels("");
    setRequestId(newRequestId());
  }

  async function submit(openAfter: boolean) {
    const estimate = estimateHours.trim() ? Math.round(Number(estimateHours) * 60) : null;
    const r = await call<string>(
      "create_task",
      {
        p_workspace: workspace.id,
        p_title: title.trim(),
        p_description: description,
        p_category: categoryId || null,
        p_work_type: workType,
        p_complexity: complexity,
        p_estimated_minutes: estimate && estimate > 0 ? estimate : null,
        p_due_at: dueDate ? cairoLocalToIso(dueDate, dueTime || "23:59") : null,
        p_queue: parent ? parent.queue : queue,
        p_priority_level: isManager ? priority : null,
        p_assignee: isManager ? assignee || null : null,
        p_parent: parent?.id ?? null,
        p_labels: parseLabels(labels),
        p_expected_deliverables: deliverables.split("\n").map((x) => x.trim()).filter(Boolean),
        p_request_id: requestId,
      },
      { success: parent ? "Subtask created" : "Task created" },
    );
    if (r.ok) {
      reset();
      onClose();
      if (openAfter && r.data) router.push(`/tasks/${r.data}`);
    }
  }

  const estimateInvalid = estimateHours.trim() !== "" && !(Number(estimateHours) > 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={parent ? `New Subtask of "${parent.title}"` : "New Task"}
      description={
        isManager ? "The employee is notified. They control status and progress." : "Tasks you create are tagged as your initiative. The manager is notified and sets priority."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!parent && (
            <Button disabled={!title.trim() || estimateInvalid} loading={pending} onClick={() => submit(true)}>
              Create &amp; Open
            </Button>
          )}
          <Button variant="primary" disabled={!title.trim() || estimateInvalid || (isManager && !assignee)} loading={pending} onClick={() => submit(false)}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={200} />}</Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description">{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        </div>
        {isManager && !parent && (
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
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Work type">
          {(id) => (
            <Select id={id} value={workType} onChange={(e) => setWorkType(e.target.value as TaskWorkType)}>
              {(Object.keys(WORK_TYPE_LABEL) as TaskWorkType[]).map((w) => (
                <option key={w} value={w}>
                  {WORK_TYPE_LABEL[w]}
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
        <Field label="Estimated hours (optional)" error={estimateInvalid ? "Enter a positive number" : undefined}>
          {(id) => <Input id={id} inputMode="decimal" value={estimateHours} onChange={(e) => setEstimateHours(e.target.value)} placeholder="e.g. 3.5" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Deadline date">{(id) => <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
          <Field label="Time (Cairo)">{(id) => <Input id={id} type="time" value={dueTime} disabled={!dueDate} onChange={(e) => setDueTime(e.target.value)} />}</Field>
        </div>
        {!parent && (
          <Field label="Queue">
            {(id) => (
              <Select id={id} value={queue} onChange={(e) => setQueue(e.target.value as TaskQueue)}>
                <option value="planned">Planned</option>
                <option value="active">Active</option>
              </Select>
            )}
          </Field>
        )}
        {isManager && !parent && (
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
        <div className="sm:col-span-2">
          <Field label="Expected deliverables (one per line, optional)">
            {(id) => <Textarea id={id} value={deliverables} onChange={(e) => setDeliverables(e.target.value)} placeholder={"Draft document\nFinal sign-off"} />}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Labels (comma separated, optional)">{(id) => <Input id={id} value={labels} onChange={(e) => setLabels(e.target.value)} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

export function EditTaskDialog({ open, onClose, task, categories }: { open: boolean; onClose: () => void; task: Task; categories: Category[] }) {
  const { call, pending } = useRpc();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [categoryId, setCategoryId] = useState(task.category_id ?? "");
  const [workType, setWorkType] = useState<TaskWorkType>(task.work_type);
  const [complexity, setComplexity] = useState<TaskComplexity>(task.complexity);
  const [estimateHours, setEstimateHours] = useState(task.estimated_minutes ? String(+(task.estimated_minutes / 60).toFixed(2)) : "");
  const [labels, setLabels] = useState(task.labels.join(", "));
  const estimateInvalid = estimateHours.trim() !== "" && !(Number(estimateHours) > 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit Task Details"
      description="Both of you can edit content. Every change is recorded in the history. Deadline, status and priority have their own controls."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!title.trim() || estimateInvalid}
            loading={pending}
            onClick={async () => {
              const estimate = estimateHours.trim() ? Math.round(Number(estimateHours) * 60) : null;
              const r = await call(
                "update_task",
                {
                  p_task: task.id,
                  p_expected_version: task.record_version,
                  p_patch: {
                    title: title.trim(),
                    description,
                    category_id: categoryId || null,
                    work_type: workType,
                    complexity,
                    estimated_minutes: estimate,
                    labels: parseLabels(labels),
                  },
                },
                { success: "Task saved" },
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
          <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}</Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description">{(id) => <Textarea id={id} rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        </div>
        <Field label="Category">
          {(id) => (
            <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories
                .filter((c) => !c.archived_at || c.id === task.category_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archived_at ? " (archived)" : ""}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Work type">
          {(id) => (
            <Select id={id} value={workType} onChange={(e) => setWorkType(e.target.value as TaskWorkType)}>
              {(Object.keys(WORK_TYPE_LABEL) as TaskWorkType[]).map((w) => (
                <option key={w} value={w}>
                  {WORK_TYPE_LABEL[w]}
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
        <Field label="Estimated hours" error={estimateInvalid ? "Enter a positive number" : undefined}>
          {(id) => <Input id={id} inputMode="decimal" value={estimateHours} onChange={(e) => setEstimateHours(e.target.value)} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Labels (comma separated)">{(id) => <Input id={id} value={labels} onChange={(e) => setLabels(e.target.value)} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}
