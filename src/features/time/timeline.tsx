"use client";

import clsx from "clsx";
import Link from "next/link";
import { formatDuration, formatTime } from "@/lib/dates";
import type { ActivitySegment } from "@/lib/types";
import { activityTitle } from "./live";

const KIND_STYLE: Record<ActivitySegment["kind"], string> = {
  task: "bg-primary-gradient",
  general: "bg-teal",
  unassigned: "bg-[repeating-linear-gradient(135deg,var(--color-warning-edge)_0_6px,var(--color-warning-tint)_6px_12px)] border border-warning-edge",
};

/**
 * Horizontal day timeline (Decision 86). Bars are positioned between `from` and `to`; open segments run to `now`.
 * The list below the bar carries the same information for screen readers and small screens.
 */
export function Timeline({
  segments,
  tasksById,
  from,
  to,
  now,
  showList = true,
  compact,
}: {
  segments: ActivitySegment[];
  tasksById: Map<string, { title: string; parent_task_id: string | null }>;
  from: number;
  to: number;
  now: number;
  showList?: boolean;
  compact?: boolean;
}) {
  const span = Math.max(1, to - from);
  const visible = segments
    .filter((s) => !s.voided_at)
    .map((s) => ({ s, start: Math.max(from, Date.parse(s.started_at)), end: Math.min(to, s.ended_at ? Date.parse(s.ended_at) : now) }))
    .filter((x) => x.end > x.start);
  const hours = [0, 6, 12, 18, 24];

  return (
    <div className="flex flex-col gap-2">
      <div className={clsx("relative w-full overflow-hidden rounded-[10px] bg-surface-alt", compact ? "h-4" : "h-7")} aria-hidden>
        {visible.map(({ s, start, end }) => (
          <div
            key={s.id}
            title={`${activityTitle(s, tasksById)} · ${formatTime(new Date(start).toISOString())}–${s.ended_at ? formatTime(s.ended_at) : "now"}`}
            className={clsx("absolute top-0 h-full rounded-[6px]", KIND_STYLE[s.kind], !s.ended_at && "animate-pulse")}
            style={{ left: `${((start - from) / span) * 100}%`, width: `max(3px, ${((end - start) / span) * 100}%)` }}
          />
        ))}
      </div>
      {!compact && span >= 20 * 3600 * 1000 && (
        <div className="flex justify-between text-[11px] text-ink-soft tabular" aria-hidden>
          {hours.map((h) => (
            <span key={h}>{String(h % 24).padStart(2, "0")}:00</span>
          ))}
        </div>
      )}
      {showList && (
        <ul className="flex flex-col gap-1 text-sm">
          {visible.length === 0 && <li className="text-ink-soft">No recorded activity.</li>}
          {visible.map(({ s, start, end }) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className={clsx("size-2.5 shrink-0 rounded-full", s.kind === "task" ? "bg-primary" : s.kind === "general" ? "bg-teal" : "bg-warning")} aria-hidden />
              <span className="tabular w-24 shrink-0 text-ink-soft">
                {formatTime(new Date(start).toISOString())}–{s.ended_at ? formatTime(new Date(end).toISOString()) : "now"}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {s.kind === "task" && s.task_id ? (
                  <Link href={`/tasks/${s.task_id}`} className="hover:text-primary-strong">
                    {activityTitle(s, tasksById)}
                  </Link>
                ) : (
                  <span className={s.kind === "unassigned" ? "text-warning" : undefined}>{activityTitle(s, tasksById)}</span>
                )}
              </span>
              <span className="tabular shrink-0 text-xs text-ink-soft">{formatDuration((end - start) / 1000)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TimelineLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-ink-soft">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-primary" /> Task
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-teal" /> General activity
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-warning" /> Unassigned
      </span>
    </div>
  );
}
