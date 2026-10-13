# Hobzerve — Product Requirements Document
Version 0.3 — Implementation baseline, 12 October 2026. DECISION_REGISTER.md is canonical; this document restates it for implementation.

## 1. Product objective and authority
Employee-owned work tracking for one employee and one manager at launch, extensible to many employees, managers and workspaces. Employee controls start/hold/complete/cancel/reopen and progress. Manager controls rank, priority and workspace settings; edits task content, scope and deadlines; requests operational changes; can inspect live work and activity. No manager verification, no composite performance score. All consequential edits audited. Newest approved decision supersedes older.

## 2. Users, tenancy, access
Roles employee and manager; workspace memberships (with effective dates, for proration per 110) determine scope. One initial workspace (name set at seed time) in Africa/Cairo with two seeded accounts (115): manager ahmed.badr@docspert.com; employee abdelwahab.magdy@docspert.com (Product Manager / Business Analyst). Public self-registration disabled; passwords never committed. Manager can read linked employee tasks, work activity, attendance and reports; employee sees their own and manager's relevant task modifications. Server enforces permissions via RLS and transactional RPC/service functions, not UI only. A manager cannot directly edit employee progress, statuses, attendance or employee's live session. Employee cannot set manager ranking or priority. Archive and restore without normal permanent delete.

## 3. Navigation and calendar
Top tabs: Dashboard, Tasks, Calendar, Time, Analytics, Notifications; Settings via user menu. Calendar also reachable from dashboard date cards. Employee opens own month calendar; manager opens linked employee's monthly calendar (employee selector later). Clicking any date opens Daily Summary with source-linked records. See CALENDAR_SPEC.md. Calendar data comes from genuine attendance/activity/task audit in the workspace timezone.

## 4. Task management
Task fields: id, workspace, assigned employee, creator, optional parent task (one level in v1), type daily/routine|one-off|major project, category (initial Operations/BD/Product Management/Tech), title, description, labels, complexity simple/moderate/complex, expected-hours nullable, estimated-date nullable, priority level and ordered queue rank (manager-managed), origin employee initiative/assigned, queue planned/active, lifecycle not_started/in_progress/on_hold/completed/cancelled, manual 0..100 progress, start/finish/archived timestamps. Queue and lifecycle are orthogonal. Dependencies warn if unresolved; never hard-block execution. Planned→Active controlled by employee and notified to manager. Active and Planned have separate rank lists. Recurring daily/weekly templates produce standalone task instances.

## 5. Deliverables and scope
Expected deliverable status not_started/in_progress/delivered/not_applicable; extra deliverables are individual records tagged self_initiated or manager_requested with optional evidence. Both users can edit scope with versioned history and counterparty notifications. On completion show deliverable modal; missing expected entries require reasons, open subtasks require reasons. Employee closes immediately, records first_completed_at and an immutable completion snapshot including the due date at completion. First completion counts only once. Manager can request revisions but cannot reject/undo completion. Employee reopens as revision round in same scope cycle or additional scope cycle; additional scope post-completion creates a new cycle. Revisions are not separate throughput. A completed parent with open subtasks blocks further work on them until the employee reopens the parent (105).

## 6. Deadlines
- Both parties may edit the due date with mandatory reason; actor, old/new date and timestamp are recorded immutably. Deadline edits notify the counterpart.
- **Deadline lock (108):** while a task is `completed`, neither role can edit its deadline (enforced server-side). Changing it requires the employee to reopen the task first.
- **Two on-time metrics (108):** *On-time at completion* compares first_completed_at with the due date frozen in the completion event. *On-time restated* (104) compares it with the latest effective deadline, including for historical periods, labelled "restated" with evaluation timestamp. Both always shown together.
- Original and intervening dates and issued report PDFs are never altered.

## 7. Attendance and live activity
Employee may have multiple separate clocked sessions/day but max one currently open, across devices. After clock-in prompt activity; if none, create clearly labelled unassigned segment. One live segment at a time; switch is atomic close-old/open-new; clock-out atomically closes live segment at exact session end. General activity exists without a task. Parent direct work and subtask work selectable. On-hold/planned tasks warn but work log may continue, not changing status. Offline/closed browser: persistent server state, signed-in client resumes. Correct/split history with audit. Clock-out offers optional recap. Manager sees latest confirmed live item, freshness and date timeline, not a claim that the user is physically present.

## 8. Task time
Standalone timer or manual entry independent of attendance; one active standalone task timer per employee; overlapping manual entries allowed and flagged. Show raw sum and union duration separately. Attendance-linked live-task segments may be represented as time entries using a source id, with unique source constraint to prevent duplicate inserts. Do not sum parent rollup and children again. Independent timer may continue after clock-out; live segment must not.

## 9. Hours and paid overtime
- Only CLOSED attendance sessions enter payable calculations. Open sessions are live provisional only.
- Business week Saturday 00:00 to next Saturday 00:00, Africa/Cairo, DST-safe (114). Crossing sessions are allocated to local dates/weeks; source rows untouched.
- **Weekly target (110):** working days are Sunday–Thursday. `target = 20h × active_working_days_in_week / 5`, where active working days are Sun–Thu dates within membership effective dates. Friday/Saturday hours count toward the weekly total like any other hours; they are overtime only to the extent the week exceeds its target.
- `hours = union(closed attendance intervals in week)`; `regular = min(target, hours)`; `overtime = max(0, hours − target)`. Hours only; no rates or currency; task entries never count.
- **Weekly close (109):** the week closes automatically on Saturday 23:59:59 Africa/Cairo. Closed totals are frozen with a fingerprint.
- **Corrections after close (109):** recompute the closed week hypothetically and post the signed delta (regular Δ, overtime Δ) as an adjustment line in the current open week, linked to the source week and the correction audit event. Closed-week records are never rewritten. Sessions open at close are excluded and post as adjustments when closed.
- Weekly overtime (including posted adjustments) belongs to the month containing that week's Friday (53). No break tracking.

## 10. Analytics
Separate task throughput by first_completed_at; tasks worked on via meaningful progress/deliverable/task-time/completion events (not administrative edits); due-task completion rate excluding not-yet-due planned tasks; on-time at completion and on-time restated side by side (108); expected deliverable fulfillment; extras by initiator; initiative counts; month-over-month by category and type; elapsed completion days separate from tracked effort hours; deadline amendment reasons; reopen/revision events; unassigned duration; closed attendance regular/overtime with adjustments listed separately. Parent/standalone headline counts distinct from subtask counts. No composite score. Every KPI drilldown shows numerator, denominator and eligibility. Details in ANALYTICS_SPEC.md.

## 11. Notifications
In-app (Stage 1): immutable audit event for each material change; counterpart receives realtime in-app notification with deep-link and before/after summary. Similar events may group in display but audit records are never discarded. Critical alerts persist even if preferences disabled. Unread survives logout; mark-read and mark-all. Manager priority reorder pushes immediate employee alert. No self-notification.
Email (Stage 4, deferred by 113): important-event email, optional daily digest, coalescing, report emailing; on failure keep in-app event, record failed send, do NOT retry automatically (58).

## 12. Calendar day detail
Every user gets clickable month, date state and selected-day summary. Day shows attendance sessions, official closed time vs provisional live time, activity blocks including unassigned, unique task/subtask worked on, deliverable/progress/completion events, daily work categories, related notifications/deadline changes, links to tasks and role-appropriate correction actions. Days in a closed week show a "week closed" marker; corrections made there show as adjustments. Future days with deadlines show due context but never claim work. See CALENDAR_SPEC.md.

## 13. Reports and on-screen records (111)
- Reports: daily, weekly, monthly, task-history and project. Download format: PDF only.
- Filters: date range, category, type, status, priority; future employee selector.
- Raw detailed records (attendance sessions, segments, time entries, audit log) are available as authorized, filterable, paginated on-screen tables. No CSV/XLSX/raw-record file export.
- Each report stores an immutable PDF snapshot, generated_at, filter parameters and a SHA-256 source fingerprint printed in the PDF footer. Changed-since-export indicator compares fingerprints.
- Weekly/monthly reports auto-generated in-app (timing PROPOSED in OPEN_QUESTIONS.md). Emailing deferred to Stage 4.
- Report access is checked by the database with the caller's own session; the PDF is rendered from the frozen snapshot on download (119 PROPOSED).

## 14. UX and nonfunctional requirements
English default, i18n architecture ready for RTL Arabic. Responsive, accessible keyboard navigation, Kanban/list switch, task drawer/full page, search and filters, quick controls for clock/activity/task/progress. Sync status and optimistic concurrency; server-authoritative clock timestamps; timezone-aware reporting. Attachment upload controls (MIME, size, membership) and least-privilege secrets. Soft-deletion for tasks/deliverables with restore/audit.

## 15. Environments, deployment, backups (112)
- Local dev; staging Supabase project (test data) used by Vercel Preview deployments; production Supabase project used only by `main`.
- `main` is deployed to production only after migrations ran and tests passed on staging. Production migrations are an explicit documented step.
- Production: automatic daily backups enabled (plan permitting; otherwise flag as a blocker). Manual backup/restore runbook covering database and Storage objects, with a restore drill.

## 16. Acceptance / release gate
Each build stage must pass its acceptance tests in ACCEPTANCE_TESTS.md before the next begins. Migrations must run on a fresh Supabase project. Deployment requires documented environment variables and seed procedure; never ship credentials in the repo.

## 17. Proposed defaults
Listed in OPEN_QUESTIONS.md. Implement as settings; never represent as approved policy.

## Visual design (107)
Poppins, light-first premium modern SaaS styling, soft blue/lavender/teal gradients, controlled glow, rounded cards/buttons, one coherent filled-icon set, accessible responsive components and top navigation. Full spec in DESIGN_SYSTEM.md; style must not compromise data clarity, performance or workflow.
