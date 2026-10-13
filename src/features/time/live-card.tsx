"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { cairoDayBounds, cairoToday, formatDuration, formatElapsed, formatTime, weekStartOf } from "@/lib/dates";
import type { WeekSummary } from "@/lib/types";
import { CaretRight, CircleDashed, ListChecks, Note, UserCircle } from "@/components/icons";
import { activityTitle, useLiveState, useNow } from "./live";
import { Timeline, TimelineLegend } from "./timeline";

const STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * Manager's live view of one employee (Decisions 72, 76). Shows the latest server-confirmed activity and how fresh
 * that confirmation is — never a claim that the person is at the keyboard.
 */
export function LiveEmployeeCard({ employeeId }: { employeeId: string }) {
  const { workspace, members } = useWorkspace();
  const member = members.find((m) => m.user_id === employeeId);
  const live = useLiveState(workspace.id, employeeId);
  const now = useNow(1000);
  const week = useLoad(
    async () => {
      const { data, error } = await getBrowserClient().rpc("get_week_summary", { p_workspace: workspace.id, p_user: employeeId, p_week_start: weekStartOf(cairoToday()) });
      if (error) throw error;
      return data as WeekSummary;
    },
    [workspace.id, employeeId, live.data?.session?.id, live.data?.session?.ended_at],
  );
  const s = live.data;
  const stale = s ? now - s.confirmedAt.getTime() > STALE_AFTER_MS : false;
  const day = cairoDayBounds(cairoToday());

  return (
    <Card className={s?.session ? "glow-active" : undefined}>
      <CardHeader
        icon={<UserCircle size={22} />}
        title={member?.profile.display_name ?? "Employee"}
        subtitle={member?.profile.job_title ?? "Employee"}
        action={
          <Link href={`/time?user=${employeeId}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-strong hover:underline">
            Time <CaretRight size={14} />
          </Link>
        }
      />
      <div className="flex flex-col gap-4 px-5 pb-5">
        {!s && live.loading ? (
          <Spinner />
        ) : live.error ? (
          <p className="text-sm text-danger">{live.error}</p>
        ) : s ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={s.session ? "success" : "neutral"}>{s.session ? `Clocked in since ${formatTime(s.session.started_at)}` : "Clocked out"}</Badge>
              {s.session && <Badge tone="neutral">Session {formatDuration((now - Date.parse(s.session.started_at)) / 1000)}</Badge>}
              <Badge tone={stale ? "warning" : "neutral"}>
                {stale ? "Not confirmed recently — " : "Confirmed "}
                {s.confirmedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Cairo" })}
              </Badge>
            </div>

            {s.segment && (
              <div className="flex items-center gap-3 rounded-[16px] border border-line bg-surface-alt/60 px-4 py-3">
                <span className="text-primary-strong" aria-hidden>
                  {s.segment.kind === "task" ? <ListChecks size={20} /> : s.segment.kind === "general" ? <Note size={20} /> : <CircleDashed size={20} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-ink-soft">
                    {s.segment.kind === "task"
                      ? s.tasksById.get(s.segment.task_id ?? "")?.parent_task_id
                        ? "Subtask"
                        : "Task"
                      : s.segment.kind === "general"
                        ? "General activity"
                        : "Unassigned"}{" "}
                    · since {formatTime(s.segment.started_at)}
                  </p>
                  <p className="truncate font-medium">
                    {s.segment.kind === "task" && s.segment.task_id ? (
                      <Link href={`/tasks/${s.segment.task_id}`} className="hover:text-primary-strong">
                        {activityTitle(s.segment, s.tasksById)}
                      </Link>
                    ) : (
                      activityTitle(s.segment, s.tasksById)
                    )}
                  </p>
                </div>
                <span className="tabular text-sm text-ink-soft">{formatElapsed((now - Date.parse(s.segment.started_at)) / 1000)}</span>
              </div>
            )}
            {s.timer && (
              <p className="text-sm text-ink-soft">
                Task timer running on <span className="font-medium text-ink">{s.tasksById.get(s.timer.task_id)?.title ?? "a task"}</span> since {formatTime(s.timer.started_at)}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Today&apos;s timeline</h3>
                <TimelineLegend />
              </div>
              <Timeline segments={s.todaySegments} tasksById={s.tasksById} from={day.start} to={day.end} now={now} />
            </div>

            {week.data && (
              <p className="tabular text-sm text-ink-soft">
                This week: <span className="font-semibold text-ink">{formatDuration(week.data.current_closed_seconds)}</span> closed of{" "}
                {formatDuration(week.data.target_seconds)} · overtime {formatDuration(week.data.overtime_seconds)}
                {week.data.provisional_open_seconds > 0 && ` · ${formatDuration(week.data.provisional_open_seconds)} live`}
              </p>
            )}
          </>
        ) : null}
      </div>
    </Card>
  );
}
