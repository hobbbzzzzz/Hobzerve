# Stage 1 Report — Foundation and tasks
Date: 2026-10-12. Gate: ACCEPTANCE_TESTS.md, Stage 1 section.

## What works
- Sign-in with the two seeded accounts; no sign-up path in the app; sign-out; session refresh via middleware.
- One workspace (Africa/Cairo) with manager and employee roles and membership effective dates.
- Row level security on every table; authenticated users can only read. All writes go through 26 Postgres functions that enforce roles, business rules, audit and notifications in one transaction.
- Tasks: create (manager assigns, employee self-creates as initiative), edit content, categories, labels, work type, complexity, estimate, deadline.
- Lifecycle (employee only): start, hold (reason, freezes progress, hold duration logged), resume, cancel (reason), reactivate, complete, reopen.
- Completion without manager verification: undelivered expected deliverables and open subtasks each need a reason; immutable completion snapshot; first completion counted once.
- Reopen as a revision round or as a new additional-scope cycle.
- Deadline changes by either role with mandatory reason and full history; **deadline locked while completed** (RPC and a table trigger), unlocked after reopen. Due date frozen in each completion event for "on-time at completion".
- Planned/Active queues: employee moves tasks (manager notified); manager ranks each queue by drag-and-drop or arrow buttons (employee notified immediately); manager sets priority level.
- Subtasks (one level), never ranked; suggested progress from subtasks shown beside manual progress; parent completed with open subtasks blocks work on them until reopened (Decision 105).
- Dependencies with cycle prevention; "waiting on" warnings that never block.
- Deliverables: expected and extra (extra tagged self-initiated or manager-requested), status by employee, edit/archive/restore, evidence as link or note, revision snapshots.
- Manager requests (revision, progress update, status change) and employee priority proposals — notify only, never change state.
- Archive and restore tasks.
- Recurring daily/weekly templates generating one task per template per date, idempotently, into the Planned queue.
- Audit log (append-only) and in-app notifications: realtime subscription, unread counts, grouping of similar notices, mark read / mark all read, important notices that can't be muted, per-event mutes.
- Screens: Dashboard (employee and manager), Tasks (Kanban and ranked List, search, eight filters, archived view), quick drawer, full task page with history, Notifications, Settings (preferences, recurring tasks, categories for the manager). Calendar, Time and Analytics tabs exist with an honest "arrives in Stage N" state and no fake data.

## Test results (run 2026-10-12)
| Suite | Result |
|---|---|
| ESLint | clean |
| TypeScript (`tsc --noEmit`, strict) | clean |
| Database tests (`tests/db`, Postgres 16, through RLS as each user) | 29 / 29 passed |
| Unit tests (`tests/unit`, Cairo date and DST conversion) | 4 / 4 passed |
| Production build (`next build`) | passed |
| Browser walkthrough (14 flows, desktop 1440px and mobile 390px) | 14 / 14 passed, no console errors |

The browser walkthrough ran the built app against real PostgREST over the migrated database, with a small stand-in for Supabase Auth. It is not part of the repo because it depends on that stand-in. Supabase Realtime was not available in that environment, so live notification delivery was not exercised there; the app showed its "Offline" state and refreshed on focus, which is the intended fallback.

### Acceptance coverage
| Test | Covered by |
|---|---|
| A01 access and tenancy | db: access and tenancy (4 tests) |
| A02 ranking and priority | db: ranking (3 tests); browser: manager reorder |
| A03 completion without verification | db: A03; browser: complete with reasons |
| A04 revision requests | db: A04 (2 tests); browser: manager request on completed task |
| A05 parent completed with open subtasks | db: A05 (2 tests) |
| A06 scope change during work | db: A06 (2 tests) |
| A07 deadline changes | db: A07 |
| A23 deadline lock | db: A23; browser: no deadline control on a completed task |
| A14 recurring instances | db: A14 |
| A15 notifications | db: A15 (2 tests); browser: notifications page |
| V01 visual baseline | browser: all pages, stroke-icon audit, mobile overflow check |

## Not verified here — please check on your Supabase project
1. `npm run seed` has not been run against a real Supabase project (no access from the build environment).
2. Realtime delivery: open the app as the employee in one browser and the manager in another; a manager action should appear in the employee's bell without refreshing, and the top bar should show "Synced".
3. `pg_cron` scheduling of recurring tasks (the migration only schedules it if the extension is available).
4. Migrations were tested on Postgres 16; Supabase runs 15 or 17. Nothing version-specific is used, but the first `db push` is the real check.

## Deferred on purpose
- Evidence file uploads (links and notes work now) → Stage 3, with private Storage.
- Kanban cards don't drag between status columns: status changes need reasons and dialogs, so they use the action buttons. Ranking drag-and-drop is in the List view.
- UI strings are inline English. `lang`/`dir` are set at the root, but extracting strings for Arabic (Decision 98) is not done yet.
- Formal accessibility audit (keyboard paths, labels and focus are in place) → Stage 4.

## PROPOSED defaults used (change any of them)
- Priority levels: Low, Medium, High, Urgent.
- Recurring instances land in the Planned queue; daily templates default to Sunday–Thursday.
- Important (non-mutable) notices: deadline changes, queue reorders, priority changes, revision requests, holds and cancellations, expected deliverables added by the manager.
- Reasons need at least 3 characters.

## How to try Stage 1
1. As the manager: create two tasks in the Active queue with deadlines and expected deliverables; open Tasks → List and reorder them.
2. As the employee: check the notifications; start a task, move progress, mark one deliverable delivered, complete it and give a reason for the other.
3. As the manager: open the completed task — there is no deadline control. Send a revision request.
4. As the employee: reopen it as a revision, change the deadline, complete it again. The task page shows two completions, only the first marked "First completion".
5. Create a parent task with a subtask, complete the parent with a reason for the subtask, then try to start the subtask.
6. In Settings, add a recurring task for today's weekday and open the dashboard; it appears in Planned.
