# Stage 2 Report — Time and payable hours
Date: 2026-10-12. Gate: ACCEPTANCE_TESTS.md, Stage 2 section. Builds on Stage 1 (see STAGE_1_REPORT.md).

## What works
- **Clock in / out** with several sessions a day and at most one open session per person across devices. A database unique index decides races: the second device gets "already clocked in", never a duplicate.
- **Live activity**: after clock-in the employee picks what they're starting with (task, subtask, general activity or unassigned). "Switch activity" is two taps: open the picker, choose a line. Switching closes the old block and opens the new one at the same server instant; clock-out closes the live block and the session at the same instant.
- **Warnings without side effects**: switching to a Planned, not-started or on-hold task warns but never changes the task. Completed or cancelled tasks, and subtasks of a completed parent, are refused.
- **Unassigned time** is shown as a persistent warning while it runs, counts as attendance but not task time, and can be re-labelled later.
- **Forgotten clock-out**: the session stays open and provisional; it is excluded from payable hours until the employee ends it. A warning appears after 12 hours (PROPOSED threshold).
- **Corrections (employee only, all audited, manager notified)**: add a past session, correct start/end, remove a session, and re-label all or part of an activity block at the real transition time. Segments are re-tiled automatically so a session is always fully covered.
- **Task time**: one standalone timer per person (keeps running after clock-out), manual entries (overlaps need confirmation), and live task activity counted automatically. Each task shows de-duplicated and raw time, parent totals including subtasks counted once, and time vs estimate.
- **Weekly target**: 20h per full week, prorated by Sunday–Thursday working days inside the membership dates. Friday/Saturday hours count toward the total, not automatically as overtime. Manager can change hours and working days from a future (or the current) Saturday; closed weeks never change.
- **Weekly close**: every Sat–Fri week closes the following Saturday at 23:59:59 Cairo (configurable). Closed regular and overtime hours are frozen with a fingerprint. Closing runs every 15 minutes through pg_cron when available, and catches up whenever someone opens Time.
- **Adjustments**: any later change that touches a closed week (added, corrected or removed session, or a forgotten session finally ended) posts the signed difference — regular and overtime separately — into the current open week, linked to the audit event. The closed week stays as it was and shows where its corrections went.
- **Overtime by month**: each week counts in the month of its Friday; the month card shows closed and provisional weeks.
- **Screens**: employee Clock card on the dashboard (session timer, current activity, today's timeline, this week vs target, running task timer); manager live card per employee (current activity, task/subtask, elapsed time, last server confirmation and a stale warning, today's timeline, week totals); Time tab (week navigation, status, target with proration note, closed/regular/overtime/live/net figures, adjustments in and out, day-by-day sessions and activity blocks with correction actions, month overtime, task time with overlaps); Time panel on every task; hours and overtime settings.

## Test results (run 2026-10-12)
| Suite | Result |
|---|---|
| ESLint | clean |
| TypeScript (strict) | clean |
| Database tests — Stage 1 | 29 / 29 passed |
| Database tests — Stage 2 | 18 / 18 passed |
| Unit tests (Cairo dates, DST, business week) | 7 / 7 passed |
| Production build | passed |
| Browser walkthrough — Stage 2 (13 flows, desktop + mobile) | 13 / 13 passed, no console errors |
| Browser walkthrough — Stage 1 regression (14 flows) | 14 / 14 passed |

The race tests (A08) run two real database connections in parallel. The browser runs used real PostgREST over the migrated database with a stand-in for Supabase Auth; Supabase Realtime was not available there, so live updates fell back to polling (every 60 s) and refresh-on-focus.

### Acceptance coverage
| Test | Covered by |
|---|---|
| A08 racing clock-in and switch | db: A08 (3 tests, two parallel connections) |
| A09 clock-out closes live block; timer keeps running | db: A09; browser: clock out with recap |
| A10 forgotten clock-out excluded | db: A10 |
| A11 20h → 0 OT, 27.5h → 7.5 OT, month by Friday, midnight split | db: A11 |
| A12 overlapping manual time | db: A12 |
| A13 unassigned counts as attendance only; re-label | db: A13; browser: re-label |
| A21 parent/subtask time counted once | db: A21 |
| A24 proration, weekend hours, Friday joiner | db: A24 |
| A25 close is idempotent and frozen | db: A25 |
| A26 / A27 adjustments (positive, negative, under target) | db: A26, A27 (2 tests); browser: closed-week correction |
| A28 forgotten session ended after close | db: A28 |
| A29 manager boundaries and live view | db: A29; browser: manager live card and read-only Time |

## Please check on your Supabase project
1. Apply the two new migrations (`…0400_stage2_schema.sql`, `…0500_stage2_rpc.sql`) after taking a dump (README → Backups).
2. `btree_gist` must be available (it is on Supabase); the migration enables it in the `extensions` schema.
3. Realtime: with the employee clocked in on one device, the manager's dashboard should change within a second when the employee switches activity. If not, check that `attendance_sessions` and `live_activity_segments` appear under Database → Publications → supabase_realtime.
4. pg_cron: Database → Cron should list `hobzerve-close-weeks` (every 15 min) and `hobzerve-recurring-instances` (hourly).
5. Seeded membership dates matter now: weeks before `active_from` aren't counted, and the first week is prorated. Set `SEED_ACTIVE_FROM` if the real start date is earlier, before using Time for payroll.

## PROPOSED defaults used in Stage 2 (change any)
- "Forgot to clock out?" warning after 12 hours.
- A single session can't exceed 24 hours; longer stretches must be split.
- Public holidays don't reduce the target.
- Membership starting on Friday/Saturday gives that week a target of 0, so all its hours are overtime (flagged on the Time page).
- Manager live card counts as "not confirmed recently" after 2 minutes without a server confirmation.

## Known gaps
- Sessions can't be backdated before the membership start date (by design) — set the correct start date first.
- The live card relies on Realtime for instant updates; without it, it refreshes every 60 seconds.
- An open session can be ended either with Clock out (current time) or from Time with a corrected end time — the latter is how a forgotten clock-out gets fixed.
