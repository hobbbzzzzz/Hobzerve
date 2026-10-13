# Hobzerve — Operations Runbook

Who this is for: whoever deploys and looks after Hobzerve (today: one Supabase project + one Vercel project, Decision 118).
Times are Cairo time unless stated. Commands assume the repo root and the Supabase CLI via `npx supabase`.

---

## 1. Environment variables

| Variable | Where | Secret? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel, `.env.local` | no | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel, `.env.local` | no (public by design; RLS protects data) | browser + server reads, RPC calls |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` only, for `npm run seed` | **yes** | never on Vercel; the app doesn't use it |
| `SMTP_USER`, `SMTP_PASS` | Vercel | **yes** (`SMTP_PASS`) | Google Workspace mailbox + app password |
| `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM` | Vercel (optional) | no | defaults: `smtp.gmail.com`, `465`, `Hobzerve <SMTP_USER>` |
| `APP_URL` | Vercel | no | public URL used for links in emails |
| `EMAIL_DISPATCH_SECRET` | Vercel **and** the database (`app.configure_email`) | **yes** | lets the database wake the email sender |

Never commit real values. `tests/unit/secrets.test.ts` fails CI if a key-shaped string lands in the repo.

---

## 2. First deployment (checklist)

1. **Supabase**
   - Authentication → Sign In / Providers → turn **off** "Allow new users to sign up".
   - Database → Extensions → enable **pg_cron** and **pg_net** *before* pushing migrations (the migrations schedule jobs only if pg_cron is already on — see §6 if you enabled it later).
   - `npx supabase login && npx supabase link --project-ref <ref>`
   - `npx supabase db push`
2. **Seed** — `cp .env.example .env.local`, fill URL, anon key, service role key, `SEED_*` (passwords ≥ 12 chars, `SEED_ACTIVE_FROM` = real start date), then `npm run seed`.
3. **Vercel** — import the repo, add the variables from §1 (Production environment), deploy.
4. **Email** — §4.
5. **Smoke test** — §8.

---

## 3. Every change to the database

1. Take a dump (§5). Not optional unless your Supabase plan has automatic backups switched on — and even then it's the quickest way back.
2. `npx supabase db push` (only new files in `supabase/migrations/` are applied).
3. Run the smoke test (§8).
4. Never edit tables in the dashboard; every change is a migration file, so a new project can be rebuilt from the repo.

---

## 4. Email (Google Workspace SMTP)

**How it works.** Notifications are created in the database. Important ones, recent automatic reports, and a daily digest (20:00 Cairo, manager can change it in Settings) are queued in `email_deliveries`. Every minute pg_cron runs `app.email_tick()`; if anything is pending it calls `POST <APP_URL>/api/email/dispatch` through pg_net with the shared secret. The route sends through SMTP and records `sent` or `failed`. **Failures are never retried automatically** (Decision 58); the in-app notification is always there.

**Set up**
1. In the sending Google Workspace account (e.g. a `notifications@docspert.com` mailbox or your own): turn on 2-Step Verification → Security → **App passwords** → create one for "Hobzerve". If the option is missing, the Workspace admin has disabled app passwords; ask them, or use a different mailbox.
2. Vercel → Settings → Environment Variables: `SMTP_USER` (the mailbox), `SMTP_PASS` (the 16-character app password, no spaces), `APP_URL`, `EMAIL_DISPATCH_SECRET` (generate: `openssl rand -hex 32`). Optional `EMAIL_FROM` — must be the mailbox itself or one of its "Send mail as" aliases. Redeploy.
3. Supabase SQL editor:
   ```sql
   select app.configure_email('https://<your-app>.vercel.app/api/email/dispatch', '<the same secret>');
   ```
4. Test: as the manager, change a deadline on one of the employee's tasks. Within ~1 minute the employee gets an email and Settings → Email → "Recent emails to you" shows **sent**.

**Switch email off:** `select app.configure_email(null, null);` (nothing is queued while off; switching on later doesn't send a backlog).

**Troubleshooting**
| Symptom | Check |
|---|---|
| Nothing queued | `select app.email_enabled();` must be true. Only *important* notices queue right away; others wait for the digest. |
| Queued but never sent | `select app.email_tick();` → `dispatch_called` should be true. If false: pg_net not enabled, or no dispatch URL. Then `select * from net._http_response order by created desc limit 5;` for the HTTP status. |
| HTTP 401 from dispatch | `EMAIL_DISPATCH_SECRET` on Vercel ≠ the secret given to `configure_email`. |
| HTTP 503 | `SMTP_USER` / `SMTP_PASS` missing on Vercel (deliveries stay pending until fixed). |
| `failed` with `535 … Username and Password not accepted` | wrong app password, or 2-Step Verification/app passwords disabled. Fix, then future emails work; failed ones are not resent. |
| `failed` with `553`/`From address` error | `EMAIL_FROM` isn't the mailbox or a verified alias. |
| Stuck in `sending` | after 10 minutes the tick marks it `failed` ("Timed out"); look at Vercel function logs for `/api/email/dispatch`. |

Gmail limits: about 2,000 messages/day per Workspace user — far above Hobzerve's needs.

---

## 5. Backups

**Before every `db push`, and weekly:**
```bash
mkdir -p ~/hobzerve-backups && cd ~/hobzerve-backups
D=$(date +%F-%H%M)
npx supabase db dump --linked -f "$D-schema.sql"
npx supabase db dump --linked --data-only -f "$D-data.sql"
npx supabase db dump --linked --role-only -f "$D-roles.sql"
```
Keep the files **outside the repo** (they contain personal data and attendance records); store them somewhere encrypted. Check Database → Backups in the Supabase dashboard: paid plans add daily automatic backups — turn them on when the project moves to production (Decision 112). Hobzerve uses no Supabase Storage, so the database dump is the whole backup.

### Restore drill (do it once now, then every quarter)
1. Create a **scratch** Supabase project (or a local Postgres 15+).
2. Restore: `psql "$SCRATCH_DB_URL" -f <D>-roles.sql -f <D>-schema.sql -f <D>-data.sql`
3. Compare with production — the numbers must match:
   ```sql
   select (select count(*) from tasks) tasks, (select count(*) from attendance_sessions) sessions,
          (select count(*) from audit_events) audit, (select count(*) from report_snapshots) reports,
          md5(string_agg(source_fingerprint, ',' order by id)) report_fingerprints
   from report_snapshots;
   select app.week_summary('<workspace id>', '<employee id>', '<a closed Saturday>') ->> 'net_overtime_seconds';
   ```
4. Delete the scratch project. Note the date and result below.

| Date | Who | Result |
|---|---|---|
| 2026-10-13 | build verification (local Postgres 16, `pg_dump -Fc` → `pg_restore`) | counts, report fingerprints and a closed week's overtime identical; append-only triggers restored after data, so the restore isn't blocked |

---

## 6. Scheduled jobs (pg_cron)

| Job | Schedule | What |
|---|---|---|
| `hobzerve-recurring-instances` | hourly | creates today's recurring task instances (idempotent) |
| `hobzerve-close-weeks` | every 15 min | closes ended weeks after Saturday 23:59; auto weekly/monthly reports |
| `hobzerve-email-tick` | every minute | digests, timeouts, wakes the email sender |

Check: `select jobname, schedule, active from cron.job;` and recent runs `select * from cron.job_run_details order by start_time desc limit 10;`.
If pg_cron was enabled after the migrations ran, schedule them by hand:
```sql
select cron.schedule('hobzerve-recurring-instances', '7 * * * *', 'select app.generate_all_recurring_instances()');
select cron.schedule('hobzerve-close-weeks', '*/15 * * * *', 'select app.close_due_weeks()');
select cron.schedule('hobzerve-email-tick', '* * * * *', 'select app.email_tick()');
```
Without pg_cron the app still works: recurring tasks are generated when the dashboard opens and weeks close when Time opens — but emails won't go out.

---

## 7. Moving from the POC project to a production project (when ready)

1. Create a new Supabase project (paid plan with automatic backups). Enable pg_cron and pg_net. Turn off sign-ups.
2. `npx supabase link --project-ref <new>` → `npx supabase db push` (rebuilds the schema from the repo).
3. Copy data from the POC: dump `--data-only` from the old project and restore into the new one (including `auth.users`, so logins keep working: `npx supabase db dump --linked --data-only --schema auth,public`).
4. `select app.configure_email(...)` on the new project with a **new** secret; update Vercel Production variables (URL, anon key, secret).
5. Point Vercel **Preview** at the old project and use it as staging from then on (restores Decision 112's split).
6. Smoke test (§8). Keep the old project read-only for two weeks before deleting.

---

## 8. Smoke test after any deploy (5 minutes)

1. Sign in as each account.
2. Employee: clock in → switch activity → clock out; the manager's dashboard live card updates.
3. Manager: change a deadline → employee gets the notification (and an email if switched on).
4. Calendar: today shows the session. Analytics loads. Reports → open any PDF.
5. Time: this week's figures look right; no unexpected adjustments.

---

## 9. Rotating secrets

- **Dispatch secret:** new value in Vercel → redeploy → `select app.configure_email('<url>', '<new>');`. Emails pending in between are sent on the next tick.
- **SMTP app password:** create a new one, update `SMTP_PASS`, redeploy, revoke the old one in Google.
- **Supabase keys:** rotate in the dashboard (Settings → API), update Vercel and `.env.local`.

---

## 10. Common support cases

| Case | What to do |
|---|---|
| Forgot to clock out | Employee: Time → the open session → "Correct session times" with the real end. If the week already closed, the hours post as an adjustment to the current week. |
| Wrong activity recorded | Time → day → "Re-label" with the real transition time. Attendance hours don't change. |
| Weekly close didn't happen | `select app.close_due_weeks();` (safe to run any time; it only closes ended weeks, once). |
| A report says "changed since export" | Expected after a correction. Generate a fresh report; the old snapshot stays as it was. |
