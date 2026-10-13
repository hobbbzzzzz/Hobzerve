"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { cairoDayBounds, cairoToday, formatDuration, formatElapsed, formatTime, weekStartOf } from "@/lib/dates";
import type { WeekSummary } from "@/lib/types";
import { ArrowsDownUp, CircleDashed, Clock, ListChecks, Note, PlayCircle, SignOut, Warning } from "@/components/icons";
import { ActivityPicker, type ActivityChoice } from "./activity-picker";
import { activityTitle, useLiveState, useNow } from "./live";
import { Timeline, TimelineLegend } from "./timeline";

const FORGOT_AFTER_HOURS = 12; // PROPOSED: warn when a session has been open this long (Decision 27)

/** Employee clock controls: clock in, switch activity in two taps, clock out with an optional recap. */
export function ClockCard() {
  const { workspace, userId } = useWorkspace();
  const toast = useToast();
  const live = useLiveState(workspace.id, userId);
  const now = useNow(1000);
  const { call, pending } = useRpc();
  const [picker, setPicker] = useState<null | "clock_in" | "switch">(null);
  const [recap, setRecap] = useState(false);
  const week = useLoad(
    async () => {
      const { data, error } = await getBrowserClient().rpc("get_week_summary", { p_workspace: workspace.id, p_user: userId, p_week_start: weekStartOf(cairoToday()) });
      if (error) throw error;
      return data as WeekSummary;
    },
    [workspace.id, userId, live.data?.session?.id, live.data?.session?.ended_at],
  );

  const state = live.data;
  const session = state?.session ?? null;
  const segment = state?.segment ?? null;
  const timer = state?.timer ?? null;
  const sessionSeconds = session ? (now - Date.parse(session.started_at)) / 1000 : 0;
  const segmentSeconds = segment ? (now - Date.parse(segment.started_at)) / 1000 : 0;
  const forgot = session && sessionSeconds > FORGOT_AFTER_HOURS * 3600;
  const day = cairoDayBounds(cairoToday());

  async function pick(choice: ActivityChoice) {
    const mode = picker;
    setPicker(null);
    if (mode === "clock_in" && !session) {
      const r = await call<{ warnings: string[] }>("clock_in", {
        p_workspace: workspace.id,
        p_kind: choice.kind,
        p_task: choice.taskId ?? null,
        p_general_type: choice.generalType ?? null,
      });
      if (r.ok) {
        toast("success", `Clocked in — ${choice.label}`);
        r.data.warnings?.forEach((w) => toast("warning", w));
      }
      live.reload();
      return;
    }
    const r = await call<{ warnings: string[] }>("switch_activity", {
      p_workspace: workspace.id,
      p_expected_segment: segment?.id ?? null,
      p_kind: choice.kind,
      p_task: choice.taskId ?? null,
      p_general_type: choice.generalType ?? null,
    });
    if (r.ok) {
      toast("success", `Now: ${choice.label}`);
      r.data.warnings?.forEach((w) => toast("warning", w));
    }
    live.reload();
  }

  return (
    <Card className={session ? "glow-active" : undefined}>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex size-11 items-center justify-center rounded-full ${session ? "bg-primary-gradient text-white" : "bg-tint-gradient text-primary-strong"}`}
              aria-hidden
            >
              <Clock size={22} />
            </span>
            <div>
              <h2 className="text-base font-semibold">{session ? "Clocked In" : "Clocked Out"}</h2>
              <p className="text-sm text-ink-soft">
                {!state && live.loading ? "Loading…" : session ? `Since ${formatTime(session.started_at)}` : "Not recording attendance"}
              </p>
            </div>
          </div>
          {session && (
            <p className="tabular text-2xl font-semibold text-ink" aria-label={`Session time ${formatDuration(sessionSeconds)}`}>
              {formatElapsed(sessionSeconds)}
            </p>
          )}
        </div>

        {live.error && <p className="text-sm text-danger">{live.error}</p>}

        {session && segment && (
          <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-line bg-surface-alt/60 px-4 py-3">
            <span className="text-primary-strong" aria-hidden>
              {segment.kind === "task" ? <ListChecks size={20} /> : segment.kind === "general" ? <Note size={20} /> : <CircleDashed size={20} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-soft">Working on</p>
              <p className="truncate font-medium">
                {segment.kind === "task" && segment.task_id ? (
                  <Link href={`/tasks/${segment.task_id}`} className="hover:text-primary-strong">
                    {activityTitle(segment, state!.tasksById)}
                  </Link>
                ) : (
                  activityTitle(segment, state!.tasksById)
                )}
              </p>
            </div>
            <span className="tabular text-sm text-ink-soft">{formatElapsed(segmentSeconds)}</span>
          </div>
        )}

        {session && segment?.kind === "unassigned" && (
          <p className="flex items-start gap-2 rounded-[14px] bg-warning-tint px-3 py-2 text-sm text-warning" role="status">
            <Warning size={18} className="mt-0.5 shrink-0" />
            This time is unassigned. It counts as attendance but not as task time — switch to what you&apos;re doing, or re-label it later in Time.
          </p>
        )}
        {forgot && (
          <p className="flex items-start gap-2 rounded-[14px] bg-danger-tint px-3 py-2 text-sm text-danger" role="alert">
            <Warning size={18} className="mt-0.5 shrink-0" />
            You&apos;ve been clocked in for over {FORGOT_AFTER_HOURS} hours. If you forgot to clock out, clock out now and correct the end time in Time.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {!session ? (
            <Button variant="primary" icon={<PlayCircle size={18} />} loading={pending} disabled={!state} onClick={() => setPicker("clock_in")}>
              Clock In
            </Button>
          ) : (
            <>
              <Button variant="primary" icon={<ArrowsDownUp size={18} />} loading={pending} onClick={() => setPicker("switch")}>
                Switch Activity
              </Button>
              <Button icon={<SignOut size={18} />} onClick={() => setRecap(true)}>
                Clock Out
              </Button>
            </>
          )}
        </div>

        {timer && (
          <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-line px-3 py-2 text-sm">
            <Badge tone="lavender">Task timer</Badge>
            <span className="min-w-0 flex-1 truncate">{state?.tasksById.get(timer.task_id)?.title ?? "Task"}</span>
            <span className="tabular text-ink-soft">{formatElapsed((now - Date.parse(timer.started_at)) / 1000)}</span>
            <Button size="sm" loading={pending} onClick={async () => { await call("stop_task_timer", { p_entry: timer.id }, { success: "Timer stopped" }); live.reload(); }}>
              Stop
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Today</h3>
            <TimelineLegend />
          </div>
          {state ? (
            <Timeline segments={state.todaySegments} tasksById={state.tasksById} from={day.start} to={day.end} now={now} showList={false} />
          ) : (
            <Spinner />
          )}
        </div>

        <WeekStrip week={week.data} openSeconds={session ? sessionSeconds : 0} />
        {state && <p className="text-xs text-ink-soft">Confirmed with the server at {state.confirmedAt.toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo" })}.</p>}
      </div>

      <ActivityPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        onPick={pick}
        title={picker === "clock_in" ? "Clock In — What Are You Starting With?" : "Switch Activity"}
        current={segment ? { kind: segment.kind, taskId: segment.task_id, generalType: segment.general_type } : null}
      />
      {session && (
        <ClockOutDialog
          open={recap}
          onClose={() => setRecap(false)}
          onDone={() => live.reload()}
          sessionId={session.id}
          startedAt={session.started_at}
          segments={state!.todaySegments.filter((s) => s.attendance_session_id === session.id)}
          tasksById={state!.tasksById}
          now={now}
        />
      )}
    </Card>
  );
}

function WeekStrip({ week, openSeconds }: { week?: WeekSummary; openSeconds: number }) {
  if (!week) return null;
  const pct = week.target_seconds ? Math.min(100, (week.current_closed_seconds / week.target_seconds) * 100) : 100;
  return (
    <div className="flex flex-col gap-2 rounded-[16px] bg-surface-alt/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">This week</p>
        <p className="tabular text-sm text-ink-soft">
          <span className="font-semibold text-ink">{formatDuration(week.current_closed_seconds)}</span> of {formatDuration(week.target_seconds)} target
          {week.active_working_days < week.working_days.length && ` (prorated: ${week.active_working_days}/${week.working_days.length} working days)`}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Closed hours toward weekly target">
        <div className="h-full rounded-full bg-primary-gradient" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge tone={week.overtime_seconds > 0 ? "lavender" : "neutral"}>Overtime so far {formatDuration(week.overtime_seconds)}</Badge>
        {openSeconds > 0 && <Badge tone="warning">+{formatDuration(openSeconds)} live, not final until you clock out</Badge>}
      </div>
    </div>
  );
}

function ClockOutDialog({
  open,
  onClose,
  onDone,
  sessionId,
  startedAt,
  segments,
  tasksById,
  now,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  sessionId: string;
  startedAt: string;
  segments: Parameters<typeof Timeline>[0]["segments"];
  tasksById: Parameters<typeof Timeline>[0]["tasksById"];
  now: number;
}) {
  const { workspace } = useWorkspace();
  const { call, pending } = useRpc();
  const [summary, setSummary] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Clock Out"
      description="Your current activity ends at the same moment. A running task timer keeps going until you stop it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep Working
          </Button>
          <Button
            variant="primary"
            icon={<SignOut size={18} />}
            loading={pending}
            onClick={async () => {
              const r = await call("clock_out", { p_workspace: workspace.id, p_expected_session: sessionId, p_summary: summary.trim() || null }, { success: "Clocked out" });
              if (r.ok) {
                setSummary("");
                onClose();
                onDone();
              }
            }}
          >
            Clock Out Now
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Session: <span className="font-medium">{formatTime(startedAt)} – now</span> · <span className="tabular">{formatDuration((now - Date.parse(startedAt)) / 1000)}</span>
        </p>
        <Timeline segments={segments} tasksById={tasksById} from={Date.parse(startedAt)} to={now} now={now} />
        <p className="text-xs text-ink-soft">Wrong activity somewhere? Clock out first, then re-label it in Time — the change is kept in the history.</p>
        <Field label="Summary of the session (optional)">{(id) => <Textarea id={id} value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
