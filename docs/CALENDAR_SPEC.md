# Hobzerve — Calendar Functional Specification
Status: Decision 106 APPROVED (core behaviour). Indicator density and styling are PROPOSED.

## Purpose
Every authorized user gets a monthly calendar; selecting any date opens a Daily Summary of what that employee worked on that day. Employee sees own days; manager sees linked employee days. Designed for a multi-employee selector later.

## UI
- Calendar is a top navigation entry with month/year heading, previous/next month, Today button and selected-date deep-link `?date=YYYY-MM-DD`.
- Month grid in the **workspace timezone (Africa/Cairo)**; day cells show compact, accessible indicators (PROPOSED): closed attendance duration, number of distinct worked-on tasks, unassigned-activity warning, optional completion dot. No activity → neutral empty state, not a zero-productivity judgement.
- Days belonging to a closed payroll week (109) carry a subtle "week closed" marker.
- Clicking any day opens the Daily Summary panel/page with previous/next day shortcuts, role-appropriate actions and links.
- Daily Summary sections:
  1. Attendance sessions (open/provisional and corrected records marked).
  2. Time totals: closed attendance, provisional, task-allocated, general, unassigned, standalone task time outside attendance.
  3. Timeline of all live segments with start/end.
  4. Tasks/subtasks worked on, with progress changes, deliverables and completion events.
  5. Notable deadline/rank/other audit updates.
  6. Upcoming/due task context, visually separated from actual work.
  7. If the day is in a closed week and was corrected after close: the posted adjustment, and the week it was posted into.
- Manager cannot modify employee attendance, task progress or state. Employee can use authorized correction actions with audit trail.
- Distinguish `No recorded work` from `No available data`; future days with deadlines show planned/due information only.

## Date attribution and reconciliation
- All timestamps stored as timestamptz (UTC); day boundaries from Africa/Cairo, DST-safe. Sessions crossing midnight are split for display and aggregation without modifying source rows.
- Completion/event timestamps belong to the local day of the event. "Worked on" uses a meaningful activity timestamp or positive-duration time overlap within the day; a progress/deliverable event without a timer still counts (49).
- Task time outside attendance is shown distinctly and never counted as payroll hours; overlapping entries expose raw and unique duration. Parent-child rollups avoid double counting.
- Open attendance and live segments are provisional and visibly distinct. A historical day never shows final payable hours from an unclosed session.
- Reclassified/split activity refreshes day/month views; audit preserves the previous mapping. In a closed week, the day view reflects the corrected activity, while payroll totals for that week stay frozen and the delta appears as an adjustment (109).
- Queries authorized by workspace membership, employee scope and RLS; separate month-summary and day-detail endpoints; paginated event fetch for busy days. Month summary covers the 35–42 visible cells; details fetched on selection.
- Deep-links preserve date and optional selected task id.

## Acceptance
- C01 Employee clicks Oct 12 and sees that day's attendance and work.
- C02 Manager sees linked employee but not others.
- C03 23:30–00:30 session allocated to two local dates.
- C04 Unassigned activity visible.
- C05 Open session marked provisional.
- C06 Progress-only change appears as worked on.
- C07 Task time outside attendance shown distinctly.
- C08 Correcting a day in an OPEN week updates calendar and week totals, audit preserved.
- C09 Future day with deadline shows due context but no fictitious work.
- C10 Months navigable and dates deep-linkable by keyboard.
- C11 Correcting a day in a CLOSED week updates the day's activity view, leaves the closed week's payroll totals unchanged, and shows the posted adjustment with its target week.
- C12 Days around Egypt's DST transitions show correct local-day totals (no lost or duplicated hour).
