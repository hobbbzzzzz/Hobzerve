# Hobzerve — Analytics Calculation Contract
v0.3. All metrics filter authorized employee and workspace. Weeks are Saturday–Friday in the workspace IANA timezone (Africa/Cairo, DST-safe). Store timestamps UTC; bucket by local boundaries. Aggregate in integer seconds; round for display only.

- **Task throughput**: distinct task IDs where `first_completed_at` in period; headline excludes subtasks, subtasks shown in a separate section. Reopen never creates another first completion.
- **Worked on**: distinct task IDs with progress change, deliverable activity, completion, or positive-length task time in period. Pure title/rank/deadline edits do not qualify.
- **Due-task completion**: tasks due within the reporting period (latest effective deadline) and completed / due-eligible tasks. Planned non-due excluded. Cancelled excluded from denominator and shown separately (PROPOSED).
- **On-time at completion (108)**: among distinct first-completed tasks with a due date, `first_completed_at <= due_at_at_completion` from the first completion event. Never changes after completion.
- **On-time restated (104, 108)**: same population, `first_completed_at <= latest effective deadline`. Labelled "restated" with evaluation timestamp. Since deadlines are locked while completed (108), divergence from the at-completion metric only arises after a reopen and a deadline change; the drilldown lists those tasks with their change reasons.
- Both on-time metrics are always displayed together. No due date → excluded, not late.
- **Deliverable fulfillment**: delivered expected / applicable expected (`not_applicable` excluded), counted at the first completion snapshot; current value shown separately if edited later.
- **Proactive**: distinct employee-origin tasks created in period, plus completed subset.
- **Extra outputs**: individual extra deliverable records by self-initiated vs manager-requested, scoped to date of addition or delivery (metric states which).
- **Calendar duration**: first completion minus work start (elapsed, including holds), with on-hold duration available separately. **Tracked effort**: union of time segments attributed to the task and its descendants for parent rollup; raw total and overlap also exposed.
- **Attendance final hours**: closed sessions only; union of intervals per week to guard against accidental overlaps. **Live provisional** shown separately; task timers outside attendance never count for payroll.
- **Weekly target (110)**: `1200 min × active_working_days / 5`; working days Sun–Thu (setting with effective dates); active working days are those within membership effective dates. Fri/Sat hours count toward the weekly total, not automatically as overtime.
- **Weekly overtime**: `max(0, closed_union_hours − target)`; regular = `min(target, closed_union_hours)`.
- **Weekly close & adjustments (109)**: once a week is closed, its regular/overtime come only from its `week_closures` record. Corrections affecting it appear as signed `payroll_adjustments` lines in the week where they were posted. Payroll views show per week: closed totals, adjustments posted into this week (with source week), and net.
- **Monthly overtime**: sum over weeks whose Friday is in the month, of (closed week overtime + adjustment overtime posted in that week). Weeks crossing months are not prorated between months.
- **Unassigned**: union of attendance-linked unassigned segments; never infer category or task. Tracked activity distribution may not equal attendance when unassigned exists.
- **Deadline change metrics**: change-event count and reasons; originals and change sequence exposed.
- **Report drift**: changed-since-export compares the report's stored SHA-256 source fingerprint with a fresh one (111).
- **No composite score.** Every KPI drilldown shows numerator, denominator, eligibility rule, missing-data state, filters and as-of computation time.
