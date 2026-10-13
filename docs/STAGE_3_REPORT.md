# Stage 3 Report — Calendar, analytics, reports
Date: 2026-10-12/13. Gate: ACCEPTANCE_TESTS.md, Stage 3 section, plus CALENDAR_SPEC.md C01–C12. Builds on Stages 1–2.

## What works
- **Calendar** (Decision 106): month grid in Cairo time, Saturday-first like the business week, with previous/next month, Today, and `?date=` / `?month=` deep links. Day cells show attendance (closed + live), tasks worked on, completions, unassigned-time warning, open deadlines and a lock for closed weeks. Arrow keys move between days; Enter/click opens the day.
- **Daily summary**: closed vs live attendance, time on tasks / general / unassigned, timers outside attendance (never payable), the day's timeline, sessions (split at midnight, with "added later" and "corrected" flags), tasks worked on with progress changes, deliverable activity and completions, other recorded events, and deadlines due that day — kept visually separate from work. Days are 23 or 25 hours on clock-change days. Distinguishes "no recorded work", "outside membership" and "future".
- **Closed weeks in the calendar**: a corrected day shows the corrected activity; the frozen week totals stay as they were and the day lists the adjustment and the week it was posted to.
- **Analytics** (ANALYTICS_SPEC.md): completed (first completions), worked on, due-task completion, on time at completion and on time restated side by side (with the tasks where they differ and the deadline-change reasons), deliverable fulfillment, own-initiative tasks, extra deliverables by initiator, overtime by Friday rule, unassigned time, reopens and deadline changes. Every figure opens a drilldown with its rule, numerator, denominator and the tasks behind it. Six-month trend charts (each with a table view), breakdowns by category and work type (calendar days and tracked hours kept separate). Filters: period, category, work type, priority; the manager picks the employee. No composite score anywhere.
- **Reports** (Decisions 88–91, 111): daily, weekly, monthly, task history and project reports. Each is a frozen snapshot with a SHA-256 fingerprint; "changed since export" compares it with the current records. Weekly reports are created automatically when a week closes, and the monthly report when the month's last week closes (once each). PDFs are A4, Poppins, with the fingerprint, snapshot id and page numbers in every footer.
- **Records**: attendance sessions, activity blocks, task time and the audit log as filterable, paginated on-screen tables (including removed/replaced records on request). No CSV/XLSX or raw export exists anywhere.
- Dashboard date now links to the Calendar.

## Change you should approve or reject — Decision 119 (PROPOSED)
The spec said report PDFs are stored as immutable files in Supabase Storage with signed URLs. I store the **frozen report data** instead and render the PDF on download. Same snapshot → byte-identical PDF (checked in tests). Why: no Storage bucket/policies to set up, nobody can swap a stored file, and it's fully testable. Trade-off: if the PDF layout code changes later, an old snapshot renders in the new layout (the data and fingerprint stay identical; the renderer version is printed in the footer). Say the word if you want stored PDF files instead.

## Also changed
- **Manager visibility tightened**: the access check now also requires the person being viewed to be a member of the manager's workspace. Before, data from other workspaces was still filtered out, but a manager could ask for an unrelated user id and get an empty answer instead of "not found".
- `get_week_summary` / `get_month_overtime` now wrap internal versions so scheduled jobs and reports can use them without a signed-in user. Signatures unchanged.

## Test results (run 2026-10-12/13)
| Suite | Result |
|---|---|
| ESLint, TypeScript (strict) | clean |
| Database tests — Stages 1, 2 | 29 + 18 passed |
| Database tests — Stage 3 | 18 passed |
| PDF rendering test (all five report kinds, deterministic output, fingerprint in footer, text check with pdftotext) | passed |
| Unit tests (dates, business week, no-raw-export guard) | 9 passed |
| Production build | passed; font files confirmed in the PDF route bundle |
| Browser — Stage 3 (12 flows, desktop + mobile) | 12 / 12 |
| Browser regression — Stage 1 (10 flows) and Stage 2 (9 flows) | 19 / 19 |

### Acceptance coverage
| Test | Covered by |
|---|---|
| A16 PDF only, no raw export | unit: no-raw-export guard; browser: PDF download content-type + no export control |
| A17 immutable snapshot, fingerprint, changed flag | db: A17; PDF test; browser: correction flips "changed since export" |
| A18 month + day, own vs manager scope | db: C01, C02; browser |
| A19 midnight split, provisional, future | db: C03, C05, C09 |
| A20 progress-only counts, priority-only doesn't | db: C06 |
| A30 dual on-time metric | db: A30 |
| A31 on-screen raw records | browser: Records |
| A32 automatic weekly/monthly reports, once each | db: A32; browser: listed as Automatic |
| C01–C12 | db: C01–C09, C11, C12 (23-hour and 25-hour days); browser: C10 keyboard |

## Please check on your Supabase project
1. Dump first, then push the three new migrations (`…0600`, `…0700`, `…0800`).
2. The first weekly-close run after the push generates automatic reports for every already-closed week — expect several "report ready" notices once.
3. On Vercel the PDF route runs on Node (not Edge). Open any report → PDF; it should download within a second or two.

## Known gaps
- Arabic (or other non-Latin) text in PDFs appears as "?", with a note in the PDF. The app shows it correctly. Fix needs an Arabic font plus text shaping.
- "Worked on" counts a parent task when any of its subtasks was worked on; subtasks are also counted separately. Say if you want parents counted only for their own activity.
- Records filter by start time inside the chosen range.
- Analytics are calculated on request (no caching). Fine for two people; revisit if the team grows.
