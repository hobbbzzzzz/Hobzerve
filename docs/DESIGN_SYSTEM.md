# Hobzerve — Design System (Decision 107)

Status: APPROVED user direction. Palette/token values below are proposed implementation defaults, not individually approved brand colors.

## Product aesthetic
Premium, modern, approachable SaaS productivity dashboard. Light-mode first, spacious composition, soft luminous blue/lavender/teal gradients, subtle diffuse glow, confident typographic hierarchy, rounded shapes and accessible contrast. Never make it look like a generic admin template or an aggressive neon dashboard. Visual polish must not obstruct frequent employee clock-in/activity-switch workflows or manager live status.

## Typography
- Primary application font: **Poppins** (self-host via Next.js font tooling, use lawful package delivery; never bundle font files in user deliverables sourced from private system fonts).
- Suggested weights: 400 body, 500 controls, 600 section heading, 700 key KPI. Enable `font-variant-numeric: tabular-nums` for durations, money/time, ranking and metrics.
- Maintain sensible responsive sizes: body 14–16px, readable labels, high contrast.

## Iconography
- Use ONE consistent rounded **filled / solid icon** family throughout application. Recommended: Phosphor Icons `weight="fill"` where supported, or a similarly coherent licensed filled icon set; avoid Lucide-outline defaults, stroke-only line symbols, or mixed icon families.
- Set consistent baseline sizes 18–22px for regular controls, 24px in card headers; ensure icons retain meaning at small sizes. Where a glyph is unavailable as filled, select another solid glyph from the same family rather than falling back to outlined styling.
- Decorative icon containers may use soft tinted pill/circle backgrounds.

## Proposed tokens (adjust visually with brand review)
- background: #F7F9FE; surface: #FFFFFF; surface-alt: #F1F5FF
- text-primary: #182338; text-secondary: #64748B
- primary: #6676E8; blue-soft: #A3B8FF; lavender: #BCAEFF; teal: #77CFC9
- border: #E5EAF4; success: #16856D; warning: #AA6A1D; danger: #C44760
- gradients: primary 135deg #7A8FF3 -> #A995EE; background diffuse lavender/sky radial glow at 4–10% opacity
- cards: 18–24px radius; buttons: 12–16px; pill chips fully rounded
- shadows: subtle multi-layer blur; glows only on primary highlights or currently active task, never across all cards
- animation: 120–220ms subtle transitions; respect reduced motion preference.

## Layout
- **Top navbar only**, consistent across roles: Dashboard, Tasks, Calendar, Time, Analytics, Notifications; Settings via user menu. No permanent traditional sidebar.
- Employee dashboard: current attendance/activity and switch actions prominent, then priority queue, next deadlines, quick update, week hours, calendar preview.
- Manager dashboard: live employee card above the fold including activity title, task/subtask, type, time since start, latest confirmed sync; then active ranking queue, daily activity timeline and summaries.
- Task views: Kanban + list toggle, task detail drawer for short edits, full details page for comprehensive activity/history, filled icons, responsive actions.
- Calendar: month grid with understated activity/attendance indicators; day select reveals daily summary and clickable task/activity entries; do not imply activity when there is no recorded data.
- Modal patterns: task completion deliverable checklist; required reasons for hold/cancel, incomplete deliverables, and deadline changes.

## UX & accessibility
- Keep essential controls legible and task-switch flows ≤2 intentional actions after current activity selection.
- Never rely on icon or color alone; pair with text and visible states, keyboard interactions, clear focus, accessible contrast, aria labels, screen reader labels, sufficiently large tap targets.
- Live state: distinguish 'clocked in' from 'working on X', and stale sync from confirmed presence; never represent an unverified active timer as real-time keyboard activity.
- Loading/empty/error/offline states have deliberate visual treatment; never fabricate metrics.
- Responsive: desktop-first for managers, fully usable mobile for employee clock controls and calendar.

## Implementation / review gates
- Build a token-driven UI, reuse components and avoid per-page hardcoded style. Provide screenshots at desktop/mobile breakpoints, test contrast and reduced motion, check no stroke-only icons remain.
- Use real data paths (Supabase) and realistic empty states; sample dashboard visuals must be labelled demo in development only.
- No UI layout or design embellishment may override permission, audit or time-accounting rules.
