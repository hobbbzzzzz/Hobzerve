# Hobzerve

Employee-owned work tracking for one employee and one manager at launch (Docspert), built on Next.js, Supabase and Vercel.

The full specification lives in [`docs/`](docs/). `docs/DECISION_REGISTER.md` is canonical; the build runs in four gated stages (Decision 116).

| Stage | Scope | Status |
|---|---|---|
| 1 | Foundation and tasks: auth, workspace, RLS, task engine, deliverables, scope cycles, deadlines with lock, ranking, recurring tasks, audit, in-app notifications, Kanban/List/drawer/detail, settings | Built |
| 2 | Attendance, live activity, timers, corrections, weekly close, proration, payable overtime, manager live card | Built |
| 3 | Calendar, analytics (both on-time metrics), on-screen raw records, PDF reports with fingerprint | Built |
| 4 | Email (Google Workspace SMTP), security/DST/accessibility passes, runbook and restore drill | **Built — this release** (moving to a separate production project is documented, not done: Decision 118) |

Details, test results and known gaps per stage: [`docs/STAGE_1_REPORT.md`](docs/STAGE_1_REPORT.md), [`docs/STAGE_2_REPORT.md`](docs/STAGE_2_REPORT.md), [`docs/STAGE_3_REPORT.md`](docs/STAGE_3_REPORT.md), [`docs/STAGE_4_REPORT.md`](docs/STAGE_4_REPORT.md). Operations (deploy, email setup, backups, restore drill, cutover): [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind CSS 4
- Supabase: Postgres with row level security, Auth (email + password), Realtime
- Phosphor Icons (filled weight only) and Poppins, self-hosted from npm (Decision 107)
- pdf-lib for PDF reports (rendered server-side in a Node route, Poppins embedded)
- nodemailer over Google Workspace SMTP for email
- Vitest for unit and database tests

## How the app is put together

- **Reads** go straight from the browser to Supabase and are filtered by RLS: an employee sees their own work, a manager sees the workspace.
- **Writes never touch tables directly.** Every change is a Postgres function (`supabase/migrations/*_stage1_rpc.sql`) that checks the caller's role, applies the business rule, writes an immutable audit event and creates the in-app notification in one transaction. The UI hides actions a role can't take, but the database is what enforces it.
- **Concurrency:** operational edits carry `expected_version`; a stale edit gets a clear "changed since you opened it" error instead of overwriting.
- **Time:** everything is stored in UTC and shown in Cairo time (Africa/Cairo, DST-aware).

## Setting it up (one Supabase project, POC — Decision 118)

### 1. Supabase project

1. In Supabase → **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up".
2. Enable `pg_cron` and `pg_net` in **Database → Extensions**. The migrations then schedule recurring-task generation (hourly), the weekly close (every 15 min) and the email tick (every minute). Without pg_cron the app still works, but email won't go out — see [RUNBOOK §6](docs/RUNBOOK.md) to schedule the jobs later. `btree_gist` is enabled by the Stage 2 migration.
3. Then apply the migrations in `supabase/migrations/`, in filename order. Either:
   - **CLI (recommended):** `npx supabase login`, `npx supabase link --project-ref <your-ref>`, then `npx supabase db push`.
   - **SQL editor:** paste each file, oldest first, and run it.
4. Never change tables from the dashboard. Every schema change is a migration file in this repo, so the database can be rebuilt on a new production project later.

### 2. Seed the two accounts

```bash
cp .env.example .env.local      # fill in URL, anon key, service role key and the SEED_* values
npm install
npm run seed
```

`npm run seed` creates (or reuses) the manager and employee accounts, the workspace in Africa/Cairo, the two memberships and the four starting categories. Passwords come from `.env.local` only and must be at least 12 characters. Running it again changes nothing that already exists.

`SEED_ACTIVE_FROM` sets the first day the memberships count from; Stage 2 prorates the weekly target from that date.

### 3. Run locally

```bash
npm run dev
```

Open http://localhost:3000 and sign in with either seeded account.

### 4. Deploy on Vercel

1. Import the GitHub repo in Vercel (framework: Next.js).
2. Add environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus the email variables in `.env.example` (`SMTP_USER`, `SMTP_PASS`, `APP_URL`, `EMAIL_DISPATCH_SECRET`). Do **not** add the service role key to Vercel; the app never needs it.
3. Switch email on in the database — see [docs/RUNBOOK.md §4](docs/RUNBOOK.md).
4. Deploy.

**With a single Supabase project, Preview deployments use the same database as production.** Anything you click on a preview URL creates real records. Either treat previews as real, or remove the Supabase variables from the Preview environment until a separate project exists.

## Tests

```bash
npm run lint
npm run typecheck
npm test            # unit tests + database tests
npm run build
```

Database tests apply a small Supabase stand-in (`tests/db/supabase-stub.sql`) plus every migration to a **throwaway local Postgres** given by `TEST_DATABASE_URL`, then act as each user through RLS. They drop and recreate schemas, so never point `TEST_DATABASE_URL` at the Supabase project.

Quick local Postgres for tests:

```bash
docker run --rm -d -p 54329:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=hobzerve_test postgres:16
export TEST_DATABASE_URL=postgres://postgres@localhost:54329/hobzerve_test
npm run test:db
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, all tests against a Postgres service, and a production build on every push and pull request.

## Backups before each stage

Check whether your Supabase plan includes automatic backups (Database → Backups). Either way, before applying a new stage's migrations take a manual dump:

```bash
npx supabase db dump --linked -f backups/$(date +%F)-schema.sql
npx supabase db dump --linked --data-only -f backups/$(date +%F)-data.sql
```

Keep the dumps outside the repo (`backups/` is a suggestion; add it to `.gitignore` if you keep it inside). Hobzerve doesn't use Supabase Storage (report snapshots live in the database). Take the dump before every `db push`, not only at stage boundaries.

## Project layout

```
src/app/(auth)/login            sign-in
src/app/(workspace)/…           dashboard, tasks, tasks/[id], notifications, settings, stage placeholders
src/features/tasks              board, list, drawer, detail, dialogs, deliverables
src/features/time               clock card, activity picker, Time tab, corrections, live card
src/features/{calendar,analytics,reports,records}   Stage 3 screens; reports/ also holds the PDF renderer and fonts
src/app/api/reports/[id]/pdf    the only download route (PDF)
src/features/{dashboard,notifications,settings}
src/components                  top navigation, realtime feed, UI primitives, icon set
src/lib                         Supabase clients, session context, dates (Cairo), labels, types
supabase/migrations             schema, RLS, RPCs (the business rules live here)
scripts/seed.mjs                first accounts and workspace
tests/db, tests/unit            database and unit tests
docs/                           specification and stage reports
```
