/** Workspace timezone (Decision 114). Display formatting always uses it so both users see the same business day. */
export const WORKSPACE_TZ = "Africa/Cairo";

const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: WORKSPACE_TZ, day: "numeric", month: "short", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: WORKSPACE_TZ, weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: WORKSPACE_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: WORKSPACE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : "—";
}
export function formatShortDate(iso: string | null | undefined): string {
  return iso ? shortDateFmt.format(new Date(iso)) : "—";
}
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? `${shortDateFmt.format(new Date(iso))}, ${timeFmt.format(new Date(iso))}` : "—";
}

function cairoParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour === "24" ? "0" : p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset of Cairo from UTC (minutes) at a given instant; DST-aware. */
export function cairoOffsetMinutes(at: Date): number {
  const p = cairoParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** "YYYY-MM-DD" + "HH:MM" in Cairo → ISO instant (UTC). */
export function cairoLocalToIso(date: string, time = "23:59"): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  // Two passes handle instants near a DST transition.
  let offset = cairoOffsetMinutes(new Date(guess));
  let instant = guess - offset * 60000;
  offset = cairoOffsetMinutes(new Date(instant));
  instant = guess - offset * 60000;
  return new Date(instant).toISOString();
}

/** ISO instant → { date: "YYYY-MM-DD", time: "HH:MM" } in Cairo, for form inputs. */
export function isoToCairoLocal(iso: string): { date: string; time: string } {
  const p = cairoParts(new Date(iso));
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

export function cairoToday(): string {
  return isoToCairoLocal(new Date().toISOString()).date;
}

/** Whole Cairo calendar days from today until the instant (negative = overdue). */
export function daysUntil(iso: string): number {
  const target = isoToCairoLocal(iso).date;
  const today = cairoToday();
  return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

export function relativeDue(iso: string | null): { label: string; tone: "neutral" | "soon" | "overdue" } {
  if (!iso) return { label: "No deadline", tone: "neutral" };
  const overdue = Date.parse(iso) < Date.now();
  const d = daysUntil(iso);
  if (overdue) return { label: d === 0 ? "Overdue today" : `Overdue ${Math.abs(d)}d`, tone: "overdue" };
  if (d === 0) return { label: `Due today ${timeFmt.format(new Date(iso))}`, tone: "soon" };
  if (d === 1) return { label: "Due tomorrow", tone: "soon" };
  if (d <= 3) return { label: `Due in ${d} days`, tone: "soon" };
  return { label: `Due ${formatShortDate(iso)}`, tone: "neutral" };
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return formatShortDate(iso);
}

export function formatMinutes(min: number | null | undefined): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// ───────────── Stage 2 helpers ─────────────
/** Adds whole days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday … 6 = Saturday) of a "YYYY-MM-DD" date. */
export function dowOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Saturday that starts the Sat–Fri business week containing the date (Decision 33). */
export function weekStartOf(date: string): string {
  return addDays(date, -((dowOf(date) + 1) % 7));
}

export function cairoDayBounds(date: string): { start: number; end: number } {
  return { start: Date.parse(cairoLocalToIso(date, "00:00")), end: Date.parse(cairoLocalToIso(addDays(date, 1), "00:00")) };
}

export function formatDayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function formatTime(iso: string | null | undefined): string {
  return iso ? new Intl.DateTimeFormat("en-GB", { timeZone: WORKSPACE_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—";
}

/** Seconds → "7h 30m" (or "−2h 00m" when signed and negative). */
export function formatDuration(seconds: number, opts: { signed?: boolean } = {}): string {
  const sign = seconds < 0 ? "−" : opts.signed ? "+" : "";
  const s = Math.abs(Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}

/** Live clock-style elapsed time "1:05:09". */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
