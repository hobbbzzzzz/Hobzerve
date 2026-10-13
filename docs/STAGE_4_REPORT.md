# Stage 4 Report — Email, hardening, release
Date: 2026-10-13. Gate: ACCEPTANCE_TESTS.md, Stage 4 section, plus full regression. This is the last planned stage.

## What works
- **Email (Decision 120)** through Google Workspace SMTP:
  - Important events (deadline, priority and ranking changes, revision requests, holds/cancellations, manager-added deliverables, payroll adjustments) are emailed within about a minute. Several for the same person are grouped into one email.
  - Everything else goes into one **daily digest at 20:00 Cairo** (manager can change the time). No new notices → no email.
  - Automatic weekly and monthly reports are emailed with the **PDF attached**.
  - Each person switches any of the three off in Settings → Email, and sees their recent emails with status. A failed send shows the reason and is **not retried**; the in-app notice is always kept.
  - The database never holds SMTP credentials, and the app never holds a service-role key: pg_cron + pg_net wake `/api/email/dispatch` with a shared secret that both sides check.
- **Security pass (A35)**: RLS on every table; no direct table writes for signed-in users; anon can call only the two secret-checked email functions; every privileged function pins its search path; cross-workspace and cross-person attempts return "not found"; repository secrets scan in CI; security headers (no framing, nosniff, strict referrer, HSTS, permissions policy).
- **Privilege fix found in the pass**: functions added to the internal `app` schema after Stage 1 had PostgreSQL's default "anyone may execute" grant. That schema isn't exposed through the API, so nothing was reachable, but it's now locked down to the four helpers row-level security needs.
- **DST (A34)**: weeks of 167 and 169 hours, the repeated 23:00 hour in October counted once, and the Saturday close boundary moving with the clock change — all tested.
- **Accessibility**: automated axe-core audit of 10 screens as each role plus the login page — **0 findings** after darkening four colour tokens (secondary text, success, warning, danger) that were just under 4.5:1 on tinted backgrounds, and replacing faded (transparent) out-of-month calendar days with a dashed style.
- **Runbook** (`docs/RUNBOOK.md`): environment variables, first deployment, email setup and troubleshooting, backups, restore drill, scheduled jobs, POC → production cutover, smoke test, secret rotation, common support cases.

## Test results (2026-10-13)
| Suite | Result |
|---|---|
| ESLint, TypeScript (strict) | clean |
| Database + unit tests (11 files) | **98 / 98** — Stage 1: 29, Stage 2: 18, Stage 3: 18 + PDF 1, Stage 4 email: 8, security/DST: 10, unit: 14 |
| Production build | passed |
| Browser — Stage 4 (email through a real SMTP server, security headers, 21 accessibility audits) | all passed, 0 axe findings |
| Browser regression — Stages 1, 2, 3 | 10 + 9 + 12 flows passed |
| Restore drill (`pg_dump` → `pg_restore` into a fresh database) | counts, report fingerprints and a closed week's overtime identical |

### Acceptance coverage
| Test | Status |
|---|---|
| A15b email, failed send recorded, no retry | db: 8 email tests; browser: deadline change → email received by a local SMTP server → shown as sent in Settings |
| A22 staging/production isolation | **Superseded for now by Decision 118** (one project). Fresh-migration build is tested on every CI run; the cutover to a separate production project is written up in RUNBOOK §7 but not done. |
| A33 backups and restore drill | Restore drill done locally and recorded in RUNBOOK §5. Automatic backups depend on your Supabase plan — check Database → Backups. |
| A34 DST | db: 3 tests + the C12 calendar tests from Stage 3 |
| A35 security | db: 7 tests; unit: secrets scan; browser: headers |

## What I could not verify from here
1. Sending through **your** Google Workspace account (the tests used a local SMTP server). App passwords must be allowed for that mailbox.
2. pg_net calling your Vercel URL — check with `select app.email_tick();` after setup (RUNBOOK §4).
3. Anything on your real Supabase project: migrations, seed, Realtime, pg_cron.

## Your setup, in order (details in RUNBOOK §2 and §4)
1. Dump the database. 2. Enable pg_cron and pg_net. 3. `db push` (two new migrations since Stage 3: `…0900_stage4_email` and `…1000_stage4_hardening`; Stage 3's three too if not applied yet). 4. App password for the sending mailbox. 5. Vercel variables: `SMTP_USER`, `SMTP_PASS`, `APP_URL`, `EMAIL_DISPATCH_SECRET`; redeploy. 6. `select app.configure_email('<APP_URL>/api/email/dispatch', '<secret>');` 7. Smoke test (RUNBOOK §8).

## Still open (decisions for you)
- **119 PROPOSED** — report snapshots store frozen data and render the PDF on download instead of storing PDF files.
- Report emails only for periods that ended in the last 14 days (avoids a burst of old reports on the first catch-up).
- Arabic text in PDFs shows as "?" (app is fine).
- "Worked on" counts a parent when one of its subtasks was worked on.
- Public holidays don't reduce the weekly target.
- Moving to a separate production project (Decision 118 → 112).
