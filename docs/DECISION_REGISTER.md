# Hobzerve — Decision Register
Status: Consolidated implementation baseline v0.4, 2026-10-13 (adds 118 and 120, proposes 119). Supersedes v0.2 ("Performance Workspace"). Source: approved decisions in project conversation. This file is canonical; when two entries conflict, the higher-numbered APPROVED decision wins.

## Decision status semantics
- APPROVED = explicit user selection.
- REVISED / REFINED = approved, but later narrowed or changed by a newer decision (named inline).
- SUPERSEDED = replaced by a newer decision (named inline). Do not implement.
- DEFERRED = approved but scheduled for a later build stage (see AGENT_HANDOFF.md).
- PROPOSED = implementation default chosen by the assistant, not the user. Implement as a configurable setting, never present as approved policy.

## Identity, task ownership, structure
- 01 APPROVED — Initially one employee and one manager, architect for multiple teams/users.
- 02 SUPERSEDED — Manager verification no longer required; employee completion is immediate.
- 03 APPROVED — Manual task progress slider; deliverables tracked separately.
- 04 REFINED by 104, 108 — Both can edit deadlines; historical versions + mandatory reasons. Deadline edits are blocked while a task is completed (108).
- 05 APPROVED — Proactive tasks on same board, tagged separately.
- 06 APPROVED — On Hold requires reason, freezes progress, logs duration; no deadline auto-extension.
- 07 APPROVED — Employee operationally controls start/hold/submit/reopen/cancel; manager requests change.
- 08 SUPERSEDED — No separate manager verification field/workflow; completion immediate.
- 09 APPROVED — Additional scope on a previously completed task creates new independent scope cycle, historical deliverables, timing, hours.
- 10 APPROVED — Manager drag/drop numeric ranking 1..N plus Priority Level.
- 11 APPROVED — Reactivate cancelled task with all history, retain or manually adjust progress.
- 12 APPROVED — 4 initial editable/archiveable categories: Operations, Business Development, Product Management, Tech.
- 13 APPROVED — Complexity Simple/Moderate/Complex, both can modify with history.
- 14 APPROVED — Optional estimated hours compared to actual.
- 15 APPROVED — Expected deliverable states Not Started/In Progress/Delivered/Not Applicable.
- 16 APPROVED — Each extra deliverable individual record; Self-Initiated vs Manager-Requested, dated and optional evidence.
- 17 APPROVED — Attendance clock-in/out and optional per-task work time separately.
- 18 APPROVED — Dependencies and optional subtasks supported.
- 18A APPROVED — Parent progress manual; calculated suggested subtask progress separate.
- 18B APPROVED — Independent subtask completion, avoid double counting with parent.
- 18C APPROVED — Optional subtasks can be added anytime during execution.
- 18D APPROVED — Parent can be completed with unfinished subtasks: warning and reason for each.
- 18E APPROVED — After parent completion, adding subtask requires employee reopen (revision or additional scope), preserving original completion.

## Scope and deliverable edge cases
- 19 APPROVED — Revision round within existing scope cycle; do not count as new completion.
- 20 APPROVED — Manager-requested deliverables during active task added to current scope with scope-change event.
- 21 APPROVED — Missing expected deliverables at completion allowed with required reason per missing deliverable.
- 22 SUPERSEDED — Verification-rejection auto-reopen removed. Manager can request revisions; employee controls reopening.
- 23 APPROVED — Immutable submitted snapshot, new versions for changes.
- 24 REFINED by 104, 108 — Deadline history retained; on-time reported as two explicit metrics (108), not as dual penalties.
- 25 APPROVED — Dependency blocked warning, employee can still work/submit.

## Attendance, time and overtime
- 26 APPROVED — Multiple independently timed attendance sessions per day.
- 27 APPROVED — Forgotten clock-out remains open pending employee correction, alert and audit.
- 28 REFINED by 109 — Employee can backdate/add/correct sessions with audit (old/new/actor/time). Corrections touching a closed week post as adjustments (109).
- 29 APPROVED — Optional timer or manual time entry tied to task/subtask.
- 30 APPROVED — Task time may exist outside Attendance; reports expose difference.
- 31 APPROVED — Only one live task timer per employee, manual entries may overlap; no duplicate unique-work-time count.
- 32 APPROVED — No break tracking.
- 33 APPROVED — Workweek Saturday–Friday.
- 34 REFINED by 110 — Closed attendance over the weekly target is PAYABLE overtime. Target is 20h, prorated for partial weeks (110).
- 34A APPROVED — Only closed Attendance sessions are payroll-hour source; task time is analytic only.
- 34B APPROVED — Display payable overtime **hours** only, not monetary amount.
- 39 APPROVED — Open attendance contributes to provisional Live Hours only, never final payable totals.
- 40 APPROVED — Browser closure does not stop task timer; reconcile/correct on return.
- 41 APPROVED — Overlapping manual task entries allowed with warning, show raw and deduplicated durations.
- 42 APPROVED — Allocate cross-midnight/week sessions to correct days/weeks in workspace timezone; retain original record.
- 43 REVISED by 109 — Corrections to an OPEN week recalculate that week directly. Corrections to a CLOSED week never rewrite it; they post an adjustment to the current open week.

## Analytics
- 44 APPROVED — Monthly completed tasks and tasks worked on are distinct.
- 45 APPROVED — Separate KPIs, no composite performance score.
- 46 APPROVED — Parent task and subtask analytics separate; avoid double counting.
- 47 APPROVED — Scope-cycle details available within parent-level reporting, no separate headline cycle KPI report.
- 48 APPROVED — Monthly trends, category, time and deliverables breakdown.
- 49 APPROVED — Worked On requires progress/deliverable/time/completion activity; not merely administrative edits.
- 50 APPROVED — Due-task completion rate + task throughput; exclude nondue planned tasks.
- 51 APPROVED — Calendar completion duration and tracked work hours shown separately per category.
- 52 APPROVED — First completion counts once; later revisions/additional scope events not extra parent completion.
- 53 APPROVED — Weekly overtime assigned to month containing that week's Friday.
- 54 APPROVED — KPI, monthly trends, category/time, proactive work and documented deadline-change reasons.

## Notifications, UX and permissions
- 35 REFINED by 113 — Realtime in-app notifications and preferences (Stage 1). Email part DEFERRED to Stage 4.
- 36 APPROVED — Similar notifications grouped where practical, each audit event preserved.
- 37 APPROVED — Employee moves planned/active without approval, manager notified.
- 38 APPROVED — Separate manager-owned rankings for planned and active queues.
- 55 APPROVED — Personal channel/frequency preferences, critical in-app alerts retained.
- 56 APPROVED — Persistent notification center, unread count, mark read/all.
- 57 DEFERRED (113) — Optional daily email digest.
- 58 DEFERRED (113) — Failed email: do not retry automatically; ensure in-app notification persists.
- 59 APPROVED — Notify other party only; actor sees event in activity history.
- 60 DEFERRED (113) for the email part — Group adjacent email notices; in-app updates quickly (in-app part APPROVED).
- 61 APPROVED — Active rank/priority changes immediately notify employee in app. Email option DEFERRED (113).
- 62 APPROVED — All unread notices retained, chronological with original timestamps.
- 63 APPROVED — Kanban + List view.
- 64 APPROVED — Quick side drawer and full task detail page.
- 65 APPROVED — Employee landing page: clock, active tasks, upcoming deadlines, progress.
- 66 APPROVED — Search and filters (category, status, priority, deadline, creator, initiative).
- 67 APPROVED — Only employee edits progress; manager may request update.
- 68 APPROVED — Only manager changes priority level/rank; employee can propose changes.
- 69 APPROVED — Only employee edits attendance; manager sees audit.
- 70 APPROVED — Archive/soft-delete and restore, no destructive normal deletion.
- 71 APPROVED — Manager manages workspace settings; employee only personal preferences.
- 72 APPROVED — Manager can see attendance/task time/corrections/live activity timeline.
- 73 APPROVED — After clock in ask for activity; temporary unassigned allowed.
- 74 APPROVED — Switch task/general activity/clock out, track transitions/unassigned.
- 75 APPROVED — Daily/Routine, One-off, Major Project, General Activity work types.
- 76 APPROVED — Manager sees current task/subtask, type, start, elapsed and daily timeline.
- 77 APPROVED — Choose actual subtask or direct parent time for projects.
- 78 APPROVED — Unassigned counts attendance, not task time.
- 79 APPROVED — Retrospectively split incorrect activity with actual transition timestamp + audit.
- 80 APPROVED — Clock out closes live activity atomically at same time.
- 81 APPROVED — One open attendance and one live activity per employee, synchronized across devices.
- 82 APPROVED — Warning for planned/on-hold task activity; no implicit status change.
- 83 APPROVED — Optional clock-out summary/corrections.
- 84 REVISED by 106 — Top navbar: Dashboard, Tasks, Calendar, Time, Analytics, Notifications.
- 85 APPROVED — Quick controls: Clock, Switch Activity, New Task, Progress Update.
- 86 APPROVED — Interactive daily timeline with detailed events and task links.

## Reports and operations
- 87 REVISED by 111 — PDF is the only downloadable report format.
- 88 APPROVED — Daily, weekly, monthly, task history, project report.
- 89 APPROVED — Date range, category, work type, status, priority and future employee filters.
- 90 REFINED by 113 — Weekly/monthly reports auto-prepared in-app. Email sending DEFERRED to Stage 4.
- 91 APPROVED — Store export snapshots, issue dates and changed-since-export indicator.
- 92 SUPERSEDED by 111 — Raw detailed records are viewed on-screen only, not exported.
- 93 APPROVED — Seed/create initial two accounts directly in Supabase, no invite/public signup. Accounts in 115.
- 94 APPROVED — Shared workspace timezone for business-day/week calculations; user-local display optional. Timezone in 114.
- 95 APPROVED — Local dev, separate staging with test data, production.
- 96 SUPERSEDED by 112 — Automatic daily backups on production plus a manual backup/restore runbook.
- 97 SUPERSEDED by 112 — Production deploys only after staging passes.
- 98 APPROVED — English UI, architecture i18n-ready for Arabic later.
- 99 APPROVED — Persistent visible warnings for unassigned time, no invented activity/auto-stop.
- 100 APPROVED — Recurring daily/weekly task templates create separately identifiable instances.
- 101 APPROVED — Sync health indication, restore confirmed server state, deduplicate repeated writes.
- 102 APPROVED — Unassigned time review/reclassification shown separate from payable hours.

## Later additions
- 103 SUPERSEDED by 111 — (was: PDF only for all exports including raw-record tables.)
- 104 REFINED by 108 — The "restated" on-time metric uses the latest effective deadline, including for historical periods. Preserve immutable original deadlines, change reasons, previous KPI snapshots and a conspicuous "restated" indicator. Never destroy past report exports.
- 105 APPROVED — If a parent is completed while subtasks remain open, those subtasks cannot resume execution until the employee reopens the parent. Historical first completion remains counted once.
- 106 APPROVED — Every authorized user has a month calendar; selecting any day shows a daily summary of recorded work (attendance, live activities, tasks/subtasks, progress changes, notable events). Employee sees own; manager sees linked employee. Details in CALENDAR_SPEC.md. Calendar styling/indicator density remains PROPOSED.
- 107 APPROVED — Global visual direction: Poppins; polished modern light-first SaaS UI; soft gradients, restrained glow; rounded components; one filled/solid rounded icon family. See DESIGN_SYSTEM.md. Exact hex values are PROPOSED.

## Decisions of 2026-10-12 (v0.3)
- 108 APPROVED — **Deadline lock + dual on-time metric.**
  - While a task's lifecycle status is `completed`, its deadline cannot be edited by either role. To change it, the employee must reopen the task (revision or additional scope); the edit then requires the usual reason.
  - Analytics report two on-time metrics side by side: **On-time at completion** (first_completed_at ≤ due_at_at_completion, frozen in the completion event) and **On-time restated** (first_completed_at ≤ latest effective deadline, per 104). Neither replaces the other.
- 109 APPROVED — **Weekly period close for payable hours.**
  - Each Sat–Fri week closes automatically on the following Saturday at 23:59:59 Africa/Cairo (APPROVED), giving one day to fix forgotten clock-outs before close. Manager can change it in Settings; changes apply only to future closes.
  - At close, the week's regular and overtime hours are frozen in a `week_closures` record with a source fingerprint.
  - An attendance correction, backdated session, or late clock-out that touches a closed week never rewrites it. The system recomputes what that week would be, and posts the **delta** (regular hours delta and overtime hours delta, either sign) as an adjustment line in the currently open week, linked to the original week and the correction audit event.
  - Sessions still open at close are excluded from the closed week; when later closed, their closed-week portion posts as an adjustment.
  - Adjustment overtime belongs to the month of the week in which it is posted (53 applies to the posting week).
- 110 APPROVED — **Working days and partial-week proration.**
  - Standard working days are **Sunday–Thursday** (5 days). Friday and Saturday are non-working days on which work may still happen.
  - Weekly target = 20h × (active working days in week ÷ 5), where active working days are Sun–Thu dates inside the employee's membership effective dates. A full week → 20h.
  - Hours worked on Friday/Saturday are ordinary closed attendance: they count toward the weekly total like any other hours, and become overtime only to the extent the week exceeds its target.
  - Working-day set is a workspace setting with effective dates. Target and working-day changes never alter closed weeks.
  - No public-holiday calendar in v1 (PROPOSED): holidays do not reduce the target.
- 111 APPROVED — **Exports.**
  - Reports (daily, weekly, monthly, task history, project) download as PDF only.
  - Raw detailed records (attendance, time entries, audit) are viewable in authorized, filterable on-screen tables; there is no raw-record file export of any format.
  - Each report snapshot stores a SHA-256 fingerprint of its source data; the PDF footer prints the fingerprint and generation time. The changed-since-export indicator compares fingerprints.
- 112 APPROVED — **Deployment and backups.**
  - Feature/develop branches deploy to Vercel Preview against the staging Supabase project.
  - `main` deploys to production only after migrations were applied and tests passed on staging. Production migrations are applied as an explicit, documented step, never implicitly by the app.
  - Production Supabase has automatic daily backups enabled (plan permitting; if the plan lacks them, this is a release blocker to raise, not to work around silently). Manual backup/restore runbook, including Storage objects, remains required.
- 113 APPROVED — **Email deferred.** No email sending in Stages 1–3. In-app realtime notifications ship in Stage 1. Email notifications, digest, report emailing and the no-auto-retry rule (58) are built in Stage 4. Schema may include the `email_deliveries` table early, but no provider is wired before Stage 4.
- 114 APPROVED — **Workspace timezone: Africa/Cairo** (IANA). Egypt observes daylight saving time; all day/week boundary logic must be DST-safe and tested across the DST transitions.
- 115 APPROVED — **Seed accounts** (one workspace):
  - Manager: ahmed.badr@docspert.com
  - Employee (title: Product Manager / Business Analyst): abdelwahab.magdy@docspert.com
  - Passwords are set at seed time from environment variables or the Supabase dashboard; never committed. Public sign-up disabled.
- 116 APPROVED — **Build in 4 gated stages** (defined in AGENT_HANDOFF.md). Each stage ends only when its listed acceptance tests pass and the user has tried it. The full scope is built; nothing is cut.
- 117 APPROVED — **Product name: Hobzerve.** All UI, docs, repo and package names use it.

- 118 APPROVED (2026-10-12) — **Single Supabase project during the POC.** Temporarily supersedes the staging/production split in 112.
  - One Supabase project holds the real data. A separate production project may be created after the POC by replaying the migrations and copying data.
  - Automated tests never run against it: they use a throwaway local Postgres (`TEST_DATABASE_URL`).
  - Schema changes only through migration files in the repo; no dashboard edits.
  - A manual database dump is taken before each stage's migrations are applied.
  - Vercel Preview deployments, if pointed at this project, write real records.
- 112 note — its staging requirement is suspended by 118 until a production project is created; the backup clause stands as "manual dump before each stage" until then.

- 119 PROPOSED (2026-10-12, implementation choice in Stage 3, not yet approved by the user) — **Report snapshots store frozen data, not PDF files.**
  - A snapshot row holds the report's source data and SHA-256 fingerprint at generation time and is append-only (trigger-enforced).
  - The PDF is rendered from that frozen data on each download, deterministically (same snapshot → byte-identical PDF while the renderer version is unchanged). No Supabase Storage bucket or signed URLs are needed; access is checked with the caller's own session.
  - Replaces "immutable PDF objects in private Storage" in DATABASE_SCHEMA.md and "short-lived signed URLs" in PRD §13. Reason: fewer moving parts, the snapshot can't be swapped for a different file, and it is testable without Storage.

- 120 APPROVED (2026-10-13) — **Email channel.** Google Workspace SMTP (an @docspert.com mailbox with an app password). Important events by email right away (several within a minute grouped into one email); everything else in one daily digest at **20:00 Cairo** (manager-configurable); automatic weekly/monthly reports emailed with the PDF attached. Each person can switch any of the three off. Failed sends are recorded and not retried (58).
  - PROPOSED details: only reports whose period ended in the last 14 days are emailed (so a first catch-up close doesn't send dozens of old reports); a send stuck for 10 minutes is marked failed; the database wakes the sender through pg_cron + pg_net with a shared secret instead of giving the app a service-role key.

## Interpretation of current policy
- 104+108: deadline edits are impossible on a completed task; the restated metric can still diverge from the at-completion metric when a task is reopened and its deadline then changed. Both metrics are always shown with labels.
- 18D+18E+105: parent may close with open subtasks if each has a reason; later work on such subtasks requires employee to reopen parent, classified as revision/additional scope.
- 40+80: independent task timer may continue outside attendance; attendance-linked live activity auto-closes with clock-out. Never conflate them.
- 34A+43+109+110: payable hours = closed attendance, interval-unioned, per Sat–Fri week, against a prorated target, frozen at weekly close, with later corrections posted as signed adjustments.

## Remaining PROPOSED defaults (configurable, not approved)
See OPEN_QUESTIONS.md for the full list. Key items: public holidays not reducing target (110), report auto-generation timing, general-activity vocabulary, recurring-instance default queue, calendar indicator density.
