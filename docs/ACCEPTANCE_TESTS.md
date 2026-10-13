# Hobzerve — Acceptance Tests / Stage Gates
v0.3. Tests are grouped by the build stage that must pass them (116). A stage is done only when all its tests pass on staging and the user has tried the stage. Later stages re-run earlier tests as regression.

## Stage 1 — Foundation and tasks
- A01 Both seeded accounts log in; public sign-up disabled; unrelated workspace read/write denied by RLS.
- A02 Manager adjusts ranks/priority; employee notified in-app immediately; employee cannot alter manager fields via API.
- A03 Employee completes task without manager verification; incomplete expected deliverables require reasons; audit + manager in-app notification created.
- A04 Manager requests revision; task stays completed until employee reopens; first completion counted once.
- A05 Parent completed with unfinished subtasks and reasons; continuing an unfinished subtask is blocked until employee reopens parent (105).
- A06 Manager adds expected deliverable during work; previous immutable completion snapshot unchanged; scope-change notification delivered.
- A07 Deadline changed multiple times with reasons; history and notifications recorded.
- A23 Deadline lock (108): on a completed task, `change_deadline` from either role and a direct table update both fail; after employee reopens, the change succeeds with reason.
- A14 Routine recurrence idempotent per template/date; each instance separate and not automatically double counted.
- A15 Mark all notifications read; actor gets no self-notification.
- V01 Visual baseline: Poppins on all authenticated pages, filled icon family only, top navbar with all six tabs, Kanban/List and drawer render on desktop and mobile.

## Stage 2 — Time and payable hours
- A08 Two devices racing Clock In/switch cannot create duplicate open sessions or live activities; losing request gets a version conflict.
- A09 Clock Out closes the live segment at the same server timestamp; standalone timer stays active when permitted.
- A10 Forgotten Clock Out remains provisional and excluded from payable hours.
- A11 Full week (Sat–Fri), target 20h: exactly 20h → 0 OT; 27.5h → 7.5 OT; overtime assigned to the month containing Friday; cross-midnight split correct.
- A12 Overlapping manual task time shows warning, raw sum and interval union; attendance unaffected.
- A13 Unassigned activity counts in attendance, not task time; backdated split updates totals and audit.
- A21 Activity time across parent and subtasks never double counted; manual parent progress independent of suggested progress.
- A24 Proration (110): employee active from Wednesday → active working days Wed, Thu (2 of 5) → target 8h; 10h closed → 2h OT.
- A24b Weekend hours (110): full week with 16h Sun–Thu + 6h Saturday → 22h total, target 20h → 2h OT (weekend hours are not automatically overtime).
- A24c Membership starting Friday → 0 active working days → target 0 → all closed hours that week are overtime, and the Time tab flags it.
- A25 Weekly close (109): at the configured close time the week's totals freeze into one `week_closures` row; running `close_week` twice creates no duplicate.
- A26 Correction after close: adding a 3h session to a closed week that had 22h (OT 2h) leaves the closed row unchanged and posts an adjustment of regular +0h, OT +3h into the current open week, linked to the correction audit event.
- A27 Negative adjustment: shortening a closed-week session posts negative deltas; a week that was under target posts a regular-hours delta only.
- A28 Session open at close: excluded from the closed week; when the employee closes it, its closed-week portion posts as an adjustment.
- A29 Manager live card shows current activity, elapsed time and last confirmed sync; manager cannot edit attendance or live session via API.

## Stage 3 — Calendar, analytics, reports
- A18 Every user navigates months and clicks a day to see recorded work; employee own scope, manager authorized scope.
- A19 Cross-midnight attendance splits into local dates; open segments marked provisional; future due date not shown as worked.
- A20 Progress-only updates count as worked-on; priority-only edits don't; day deep-links to tasks and audit events.
- A30 Dual on-time metric (108): task completed on time, reopened, deadline moved earlier, completed again → "on-time at completion" = on time, "on-time restated" = late; drilldown lists the task with the change reason.
- A16 Daily/weekly/monthly/task/project reports download as PDF only; no CSV/XLSX or raw-record file export exists anywhere in the UI or API (111).
- A31 Raw records (attendance, segments, time entries, audit) viewable in filterable, paginated on-screen tables within role permissions.
- A17 PDF snapshot is immutable; its footer shows the SHA-256 fingerprint; a later correction flips the changed-since-export indicator.
- A32 Weekly report auto-generates in-app after weekly close; monthly after the month's last week closes.
- Calendar tests C01–C12 in CALENDAR_SPEC.md pass.

## Stage 4 — Email, hardening, release
- A15b Email (113): important-event email and optional digest send through the chosen provider; failed send is recorded, in-app event intact, no automatic retry.
- A22 Staging and production Supabase isolated; fresh-migration build works; preview deploys hit staging only; `main` deploys production only after staging migrations and tests pass (112).
- A33 Production automatic backups confirmed enabled; manual backup runbook executed once, including a restore drill to a scratch project and Storage objects.
- A34 DST (114): sessions spanning Egypt's DST start and end produce correct local-day and weekly totals.
- A35 Security pass: RLS denial suite, horizontal privilege escalation attempts, no secrets in repo history, service-role key server-only.

## Visual system acceptance (107) — checked at every stage
- Poppins loads on every authenticated page, including empty/loading/modal states; durations use tabular numerals.
- All action and navigation icons come from the selected filled family; no stroke icons.
- Top navigation, rounded UI, soft gradients and restrained glow on employee and manager pages.
- Desktop/mobile layouts, keyboard navigation, visible focus, contrast and reduced motion verified.
- Glow/gradient never makes time, deadline, warning, priority or overtime information unreadable.
