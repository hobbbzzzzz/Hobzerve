# Hobzerve — AI Coding Agent Build Contract
v0.3, 2026-10-12.

## Objective
Build **Hobzerve** in full as a GitHub-ready Next.js + TypeScript application on Vercel and Supabase, in **four gated stages** (116). Generate real source code, SQL migrations, seed scripts, tests, README and deployment docs. Never present mock data as live records.

## Required reading order
1. `DECISION_REGISTER.md` (canonical; higher-numbered approved decision wins)
2. `PRD.md`
3. `DATABASE_SCHEMA.md`
4. `ANALYTICS_SPEC.md`
5. `CALENDAR_SPEC.md`
6. `ACCEPTANCE_TESTS.md`
7. `DESIGN_SYSTEM.md`
8. `OPEN_QUESTIONS.md` (PROPOSED defaults: implement as settings, never as approved policy)

No other spec files apply. Earlier drafts (v0.1 skeleton, "Performance Workspace" v0.2) are retired; ignore them if found.

## Non-negotiable rules (summary — the register has the detail)
- No manager verification; employee completes immediately (02).
- Deadline locked while task is completed; two on-time metrics, at-completion and restated (104, 108).
- Parent must be reopened before unfinished subtasks resume (105).
- Payable hours = closed attendance only, interval-unioned, per Sat–Fri week in Africa/Cairo, against a prorated 20h target (34A, 110, 114).
- Weekly close freezes totals; later corrections post signed adjustments, never rewrite a closed week (109).
- Reports PDF only; raw records on-screen only; SHA-256 fingerprint in every report (111).
- Email (113, 120): Google Workspace SMTP; important events immediately, daily digest 20:00 Cairo, report PDFs; no automatic retry.
- One Supabase project during the POC (118): tests on local Postgres only, schema changes only via migrations, manual dump before each stage.
- Hours only, never money. Never double count parent+child time or overlapping time.
- Permissions enforced server-side (RLS + RPC), not in UI only. No secrets in the repo.

## Recommended repo
```
src/app/(auth)/login
src/app/(workspace)/{dashboard,tasks/[id],calendar,time,analytics,notifications,settings}
src/features/{tasks,deliverables,calendar,attendance,live-activity,timers,payroll,analytics,notifications,reports}
src/lib/{supabase,auth,permissions,dates,analytics,idempotency}
supabase/migrations/   supabase/seed/
tests/{unit,integration,e2e}/
docs/   (these spec files + runbooks)
.env.example   README.md
```

## Build stages
Each stage ends with: all its tests in ACCEPTANCE_TESTS.md passing on staging, a short stage report (what works, what is blocked, test output), and a pause for the user to try it. Do not start the next stage until the user confirms.

### Stage 1 — Foundation and tasks
- Repo scaffold, env setup, staging Supabase wiring, migrations runner, test rig, CI.
- Auth with seeded accounts (115), sign-up disabled, workspace + memberships with effective dates, RLS baseline.
- Design system shell: tokens, Poppins, filled icon family, top navbar (all six tabs; unbuilt tabs show an honest "coming in Stage N" state).
- Task engine: hierarchy, categories, labels, queue/lifecycle, rank and priority, dependencies, recurrence, deliverables, scope cycles, revision rounds, completion snapshots, reopen, archive/restore.
- Deadlines with reasons, history and the completed-task lock (108).
- Audit events and realtime in-app notifications with notification center.
- Kanban/List, task drawer, full task page, search and filters.
- Gate: Stage 1 tests.

### Stage 2 — Time and payable hours
- Attendance sessions, live activity segments (task/subtask/general/unassigned), atomic switch and clock-out, standalone timers, manual entries, overlap handling.
- Corrections and activity splits with audit.
- Weekly target with proration (110), weekly close job (109), payroll adjustments, Time tab showing closed totals, adjustments and net per week.
- Employee dashboard (clock controls first) and manager live card + daily timeline.
- Gate: Stage 2 tests.

### Stage 3 — Calendar, analytics, reports
- Month calendar and Daily Summary per CALENDAR_SPEC.md.
- Analytics per ANALYTICS_SPEC.md, including both on-time metrics and KPI drilldowns.
- On-screen raw record tables; PDF reports with fingerprint footer; snapshots; changed-since-export; in-app auto-generation.
- Gate: Stage 3 tests and C01–C12.

### Stage 4 — Email, hardening, release
- Before coding email, ask the user for provider, sending domain/address, triggering events and digest time.
- Email notifications, digest, report emailing, failed-send recording, no auto-retry.
- Security pass, DST tests, accessibility pass, backup runbook and restore drill.
- Production Supabase setup, migrations applied explicitly, `main` deploy.
- Gate: Stage 4 tests plus full regression.

## Reporting honesty
- Never claim a stage, test or deployment is done unless verified by actually running it.
- List unimplemented or blocked items explicitly in each stage report.
- Where a PROPOSED default is used, name it in the stage report so the user can change it.

## Visual design contract (107)
Poppins, one rounded filled icon family (Phosphor `fill` or equivalent), softly rounded shapes, pastel gradients and sparse gentle glows. Follow DESIGN_SYSTEM.md; test mobile, responsiveness and accessibility. No stroke-only Lucide defaults, no sidebar admin template.
