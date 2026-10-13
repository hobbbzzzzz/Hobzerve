"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { unwrap, useLoad } from "@/lib/client/hooks";
import { cairoLocalToIso, cairoToday } from "@/lib/dates";
import type { ActivitySegment, AttendanceSession, Task, TaskTimeEntry } from "@/lib/types";

export type TaskLite = Pick<Task, "id" | "title" | "parent_task_id" | "status" | "queue">;

export interface LiveState {
  session: AttendanceSession | null;
  segment: ActivitySegment | null;
  timer: TaskTimeEntry | null;
  todaySegments: ActivitySegment[];
  todaySessions: AttendanceSession[];
  tasksById: Map<string, TaskLite>;
  confirmedAt: Date;
}

/** Current attendance, live activity and timer for one person, plus today's timeline (Cairo day). */
export async function loadLiveState(workspaceId: string, userId: string): Promise<LiveState> {
  const sb = getBrowserClient();
  const dayStart = cairoLocalToIso(cairoToday(), "00:00");
  const [open, segs, sessions, timer] = await Promise.all([
    sb.from("attendance_sessions").select("*").eq("workspace_id", workspaceId).eq("user_id", userId).is("ended_at", null).is("voided_at", null).maybeSingle<AttendanceSession>(),
    sb
      .from("live_activity_segments")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .is("voided_at", null)
      .or(`ended_at.is.null,ended_at.gt.${dayStart}`)
      .order("started_at")
      .returns<ActivitySegment[]>(),
    sb
      .from("attendance_sessions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .is("voided_at", null)
      .or(`ended_at.is.null,ended_at.gt.${dayStart}`)
      .order("started_at")
      .returns<AttendanceSession[]>(),
    sb.from("task_time_entries").select("*").eq("user_id", userId).eq("source", "timer").is("ended_at", null).is("voided_at", null).maybeSingle<TaskTimeEntry>(),
  ]);
  const segments = unwrap(segs) ?? [];
  const t = unwrap(timer);
  const taskIds = [...new Set([...segments.map((s) => s.task_id), t?.task_id].filter((x): x is string => !!x))];
  const tasks = taskIds.length
    ? (unwrap(await sb.from("tasks").select("id, title, parent_task_id, status, queue").in("id", taskIds).returns<TaskLite[]>()) ?? [])
    : [];
  const session = unwrap(open);
  return {
    session,
    segment: segments.find((s) => !s.ended_at) ?? null,
    timer: t,
    todaySegments: segments,
    todaySessions: unwrap(sessions) ?? [],
    tasksById: new Map(tasks.map((x) => [x.id, x])),
    confirmedAt: new Date(),
  };
}

/** Live state that refetches on any realtime change to this person's attendance, activity or timers. */
export function useLiveState(workspaceId: string, userId: string | null) {
  const load = useLoad(() => (userId ? loadLiveState(workspaceId, userId) : Promise.resolve(null)), [workspaceId, userId]);
  const { reload } = load;
  useEffect(() => {
    if (!userId) return;
    const sb = getBrowserClient();
    const channel = sb.channel(`live:${userId}`);
    for (const table of ["attendance_sessions", "live_activity_segments", "task_time_entries"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` }, () => reload());
    }
    channel.subscribe();
    const poll = setInterval(reload, 60_000);
    return () => {
      clearInterval(poll);
      sb.removeChannel(channel);
    };
  }, [userId, reload]);
  return load;
}

/** Re-renders every `ms` so elapsed times tick. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function activityTitle(
  seg: Pick<ActivitySegment, "kind" | "task_id" | "general_type">,
  tasksById: Map<string, { title: string; parent_task_id: string | null }>,
): string {
  if (seg.kind === "task") return tasksById.get(seg.task_id ?? "")?.title ?? "Task";
  if (seg.kind === "general") return seg.general_type ?? "General activity";
  return "Unassigned";
}
