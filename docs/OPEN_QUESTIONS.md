# Hobzerve — Proposed Defaults & Residual Open Choices
v0.3, 2026-10-12. Decisions 108–117 resolved the previous conflicts (deadline restatement, payable-hours finality, proration, exports, deployment, email timing, timezone, accounts). What remains below are **PROPOSED** defaults: implement each as a configurable setting, label it as a default in Settings, and never describe it as approved policy.

## Proposed defaults (do not block building)
1. **Public holidays (110)**: no holiday calendar in v1; holidays do not reduce the weekly target. A holiday table can be added later without changing closed weeks.
2. **Membership starting on Fri/Sat**: if an employee's first active day in a week is Friday or Saturday, that week has 0 active working days, so target = 0 and all closed hours that week are overtime. Flag this in the Time tab rather than hiding it.
3. **Report auto-generation (90, 113)**: weekly report generated in-app immediately after the weekly close; monthly report generated after the last week whose Friday falls in that month closes. No email until Stage 4.
4. **Large report PDFs**: reports only (raw records are on-screen, 111), so size is bounded. Still paginate, generate asynchronously above a row threshold, and report failure visibly; never truncate silently.
5. **Due-task completion eligibility**: "due in period" uses the latest effective deadline, consistent with the restated metric; the at-completion on-time metric uses the frozen due date. Label both in KPI drilldowns.
6. **Cancelled/archived tasks in KPIs**: excluded from due-task denominators; shown in a separate count.
7. **Recurring instances (100)**: generated into the Planned queue; employee promotes to Active; manager ranks after promotion.
8. **General activity vocabulary**: Meeting, Planning, Research, Administration, Other; editable by manager.
9. **Calendar day indicators (106)**: closed attendance duration, worked-task count, unassigned warning, optional completion dot.
10. **Single live segment vs standalone timer**: separate sources; standalone may continue after Clock Out; live activity ends with Clock Out. Unique-time calculations union both so the same interval is never counted twice.
11. **Email (120)**: resolved — Google Workspace SMTP, important + daily digest at 20:00. Remaining PROPOSED: report emails only for periods ended in the last 14 days; 10-minute send timeout.

12. **Forgotten clock-out warning (27)**: shown after 12 hours open; nothing is auto-stopped (99).
13. **Maximum session length**: 24 hours per session; longer stretches must be split.
14. **Live card freshness**: "not confirmed recently" after 2 minutes without a server confirmation.

15. **Calendar grid**: weeks start on Saturday in the month view, matching the business week.
16. **Report notices**: automatic weekly/monthly reports notify both people in-app (mutable, not "important").
17. **Arabic text in PDFs**: shown as "?" with a note in the PDF until an Arabic-capable font and text shaping are added; the app itself shows it correctly.
18. **Report storage (119)**: frozen data in the database, PDF rendered on download, instead of PDF files in Storage.

## Questions to put to the user when the relevant stage starts
- Stage 2: confirm the public-holiday default after seeing it in Settings.
- Stage 3: confirm report auto-generation timing and the calendar indicator set.
- Stage 4: answered (Decision 120).
