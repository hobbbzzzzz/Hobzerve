"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatDuration, formatMinutes } from "@/lib/dates";
import type { Task, TaskTime } from "@/lib/types";
import { Plus, PlayCircle, Stop } from "@/components/icons";
import { ManualTimeDialog } from "./time-dialogs";

/** Tracked effort for a task: de-duplicated and raw, direct and with subtasks; timer and manual entry (Decisions 14, 29–31, 46). */
export function TaskTimePanel({ task, subtasks, locked }: { task: Task; subtasks: Task[]; locked?: boolean }) {
  const { userId, isManager } = useWorkspace();
  const { call, pending } = useRpc();
  const [adding, setAdding] = useState(false);
  const time = useLoad(async () => {
    const { data, error } = await getBrowserClient().rpc("get_task_time", { p_task: task.id });
    if (error) throw error;
    return data as TaskTime;
  }, [task.id]);
  const timer = useLoad(async () => {
    const { data } = await getBrowserClient()
      .from("task_time_entries")
      .select("id, task_id")
      .eq("user_id", userId)
      .eq("source", "timer")
      .is("ended_at", null)
      .is("voided_at", null)
      .maybeSingle<{ id: string; task_id: string }>();
    return data;
  }, [userId]);

  const workable = task.assignee_id === userId && !isManager && !locked && !task.archived_at && task.status !== "completed" && task.status !== "cancelled";
  const t = time.data;
  const runningHere = timer.data?.task_id === task.id;

  return (
    <div className="flex flex-col gap-3 text-sm">
      {!t && time.loading ? (
        <Spinner />
      ) : t ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <dt className="text-xs text-ink-soft">Tracked on this task</dt>
            <dd className="tabular font-semibold">{formatDuration(t.direct_unique_seconds)}</dd>
            {t.direct_raw_seconds !== t.direct_unique_seconds && <dd className="tabular text-xs text-warning">raw {formatDuration(t.direct_raw_seconds)} (overlaps)</dd>}
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Estimate</dt>
            <dd className="tabular font-semibold">{formatMinutes(t.estimated_minutes)}</dd>
            {t.estimated_minutes != null && (
              <dd className="tabular text-xs text-ink-soft">
                {formatDuration((subtasks.length ? t.rollup_unique_seconds : t.direct_unique_seconds) - t.estimated_minutes * 60, { signed: true })} vs estimate
              </dd>
            )}
          </div>
          {subtasks.length > 0 && (
            <div className="col-span-2">
              <dt className="text-xs text-ink-soft">With subtasks (counted once)</dt>
              <dd className="tabular font-semibold">
                {formatDuration(t.rollup_unique_seconds)}
                {t.rollup_raw_seconds !== t.rollup_unique_seconds && <span className="ml-2 text-xs font-normal text-warning">raw {formatDuration(t.rollup_raw_seconds)}</span>}
              </dd>
            </div>
          )}
        </dl>
      ) : null}
      {workable && (
        <div className="flex flex-wrap gap-2">
          {runningHere ? (
            <Button
              size="sm"
              icon={<Stop size={16} />}
              loading={pending}
              onClick={async () => {
                await call("stop_task_timer", { p_entry: timer.data!.id }, { success: "Timer stopped" });
                timer.reload();
              }}
            >
              Stop Timer
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<PlayCircle size={16} />}
              loading={pending}
              disabled={!!timer.data}
              title={timer.data ? "Another task timer is running" : undefined}
              onClick={async () => {
                await call("start_task_timer", { p_task: task.id }, { success: "Timer started" });
                timer.reload();
              }}
            >
              Start Timer
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Plus size={16} />} onClick={() => setAdding(true)}>
            Add Time
          </Button>
        </div>
      )}
      <p className="text-xs text-ink-soft">
        Live activity on this task counts automatically. Timers and manual entries are separate from attendance and never payable.
      </p>
      {adding && <ManualTimeDialog open onClose={() => setAdding(false)} tasks={[task, ...subtasks.filter((s) => s.status !== "completed" && s.status !== "cancelled")]} defaultTaskId={task.id} />}
    </div>
  );
}
