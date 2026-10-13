"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { useWorkspace } from "@/components/workspace-provider";
import { useLoad, useRpc, unwrap } from "@/lib/client/hooks";
import { getBrowserClient } from "@/lib/supabase/client";
import { addDays, cairoToday, formatDayLabel, weekStartOf } from "@/lib/dates";
import { DOW_LABEL } from "@/lib/labels";
import type { TargetSettings } from "@/lib/types";
import { Clock } from "@/components/icons";

/** Weekly target, working days, close time and activity vocabulary (Decisions 34, 109, 110). Manager edits; employee reads. */
export function TimeSettingsCard() {
  const { workspace, isManager } = useWorkspace();
  const { call, pending } = useRpc();
  const history = useLoad(
    async () =>
      unwrap(
        await getBrowserClient().from("weekly_target_settings").select("*").eq("workspace_id", workspace.id).order("effective_from", { ascending: false }).returns<TargetSettings[]>(),
      ) ?? [],
    [workspace.id],
  );
  const thisWeek = weekStartOf(cairoToday());
  const current = (history.data ?? []).find((h) => h.effective_from <= thisWeek);
  const upcoming = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, i * 7));
  const [hours, setHours] = useState<string>("");
  const [days, setDays] = useState<number[] | null>(null);
  const [from, setFrom] = useState(addDays(thisWeek, 7));
  const closeTime = String((workspace.settings?.weekly_close as { time?: string } | undefined)?.time ?? "23:59:59").slice(0, 5);
  const [close, setClose] = useState(closeTime);
  const types = (workspace.settings?.general_activity_types as string[] | undefined) ?? [];
  const [typesText, setTypesText] = useState(types.join(", "));

  const effHours = hours === "" ? String((current?.base_target_minutes ?? 1200) / 60) : hours;
  const effDays = days ?? current?.working_days ?? [0, 1, 2, 3, 4];
  const hoursValid = Number(effHours) > 0 && Number(effHours) <= 168;

  return (
    <Card>
      <CardHeader icon={<Clock size={20} />} title="Hours and overtime" subtitle="Hours only — no pay rates or amounts" />
      <div className="flex flex-col gap-5 px-5 pb-5 text-sm">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-soft">Weekly target now</dt>
            <dd className="font-medium">{(current?.base_target_minutes ?? 1200) / 60} h, prorated by working days</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Working days</dt>
            <dd className="font-medium">{(current?.working_days ?? [0, 1, 2, 3, 4]).map((d) => DOW_LABEL[d]).join(", ")}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-soft">Week closes</dt>
            <dd className="font-medium">Following Saturday at {closeTime} (Cairo)</dd>
          </div>
        </dl>
        <p className="rounded-[12px] bg-surface-alt px-3 py-2 text-xs text-ink-soft">
          <Badge tone="warning">Default</Badge> Public holidays don&apos;t reduce the weekly target yet. Tell us if they should.
        </p>

        {isManager && (
          <>
            <fieldset className="flex flex-col gap-3 rounded-[16px] border border-line p-4">
              <legend className="px-1 text-sm font-semibold">Change the weekly target</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Hours per full week" error={hoursValid ? undefined : "Enter hours between 0 and 168"}>
                  {(id) => <Input id={id} inputMode="decimal" value={effHours} onChange={(e) => setHours(e.target.value)} />}
                </Field>
                <Field label="Takes effect from" hint="Always a Saturday; closed weeks never change.">
                  {(id) => (
                    <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)}>
                      {upcoming.map((d) => (
                        <option key={d} value={d}>
                          Week of {formatDayLabel(d)}
                          {d === thisWeek ? " (current week)" : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium">Working days</p>
                <div className="flex flex-wrap gap-2">
                  {DOW_LABEL.map((label, d) => {
                    const on = effDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setDays(on ? effDays.filter((x) => x !== d) : [...effDays, d].sort())}
                        className={on ? "h-9 rounded-full bg-primary-gradient px-4 text-sm font-medium text-white" : "h-9 rounded-full border border-line px-4 text-sm text-ink-soft"}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!hoursValid || effDays.length === 0}
                  loading={pending}
                  onClick={async () => {
                    const r = await call(
                      "set_weekly_target",
                      { p_workspace: workspace.id, p_effective_from: from, p_minutes: Math.round(Number(effHours) * 60), p_working_days: effDays },
                      { success: "Weekly target saved" },
                    );
                    if (r.ok) history.reload();
                  }}
                >
                  Save target
                </Button>
              </div>
            </fieldset>

            <fieldset className="grid gap-3 rounded-[16px] border border-line p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-semibold">Close time and activity types</legend>
              <Field label="Weekly close time (Saturday, Cairo)">{(id) => <Input id={id} type="time" value={close} onChange={(e) => setClose(e.target.value)} />}</Field>
              <Field label="General activity types (comma separated)">{(id) => <Input id={id} value={typesText} onChange={(e) => setTypesText(e.target.value)} />}</Field>
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={pending}
                  onClick={async () => {
                    const r = await call(
                      "set_workspace_time_settings",
                      {
                        p_workspace: workspace.id,
                        p_close_time: close ? (close === "23:59" ? "23:59:59" : `${close}:00`) : null,
                        p_general_types: typesText.split(",").map((x) => x.trim()).filter(Boolean),
                      },
                      { success: "Time settings saved" },
                    );
                    if (r.ok) window.location.reload();
                  }}
                >
                  Save
                </Button>
              </div>
            </fieldset>
          </>
        )}

        {(history.data ?? []).length > 1 && (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-ink-soft">Target history</summary>
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {(history.data ?? []).map((h) => (
                <li key={h.id}>
                  {h.effective_from === "2000-01-01" ? "Initial default" : `From week of ${formatDayLabel(h.effective_from)}`}: {h.base_target_minutes / 60} h ·{" "}
                  {h.working_days.map((d) => DOW_LABEL[d]).join(", ")}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}
