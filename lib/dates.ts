// All scorecard weeks bucket to the Monday of the local week.
// Keep this dumb — pick one anchor day and stick to it.

export function mondayOf(d: Date = new Date()): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

export function toDateString(d: Date): string {
  // Return YYYY-MM-DD in local time (postgres `date` is tz-agnostic).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function lastNMondays(n: number, from: Date = new Date()): Date[] {
  const out: Date[] = [];
  const start = mondayOf(from);
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() - i * 7);
    out.push(d);
  }
  return out; // newest first
}

export function currentQuarter(d: Date = new Date()): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

// Last day of d's calendar quarter, at 00:00 local time.
// Q1 → Mar 31, Q2 → Jun 30, Q3 → Sep 30, Q4 → Dec 31.
export function endOfQuarter(d: Date = new Date()): Date {
  const q = Math.floor(d.getMonth() / 3); // 0..3
  const lastMonth = q * 3 + 2; // 2, 5, 8, 11
  const out = new Date(d.getFullYear(), lastMonth + 1, 0); // day 0 of next month = last day of this month
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

// "2026-05-18" or Date → "5/18"
export function formatWeekLabel(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function parseLocalDate(d: string | Date): Date {
  return typeof d === "string" ? new Date(d + "T00:00:00") : d;
}

// Monday week start → "Jul 27 – Aug 2" (Mon–Sun range, ninety-style).
export function formatWeekRange(weekStart: string | Date): string {
  const start = parseLocalDate(weekStart);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const left = `${SHORT_MONTHS[start.getMonth()]} ${start.getDate()}`;
  const right = sameMonth
    ? String(end.getDate())
    : `${SHORT_MONTHS[end.getMonth()]} ${end.getDate()}`;
  return `${left} – ${right}`;
}

// Year of a week-start Monday (for column-group headers).
export function weekYear(weekStart: string | Date): number {
  return parseLocalDate(weekStart).getFullYear();
}

// "2026-05-18" → "5/18/2026" (or whatever the browser's locale format is).
// Parses with a local-midnight anchor so a date-only string never rolls back
// a day west of UTC (`new Date("2026-05-18")` parses as UTC midnight, which
// renders as the previous day in US timezones).
export function formatDateOnly(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString();
}

// Date-only `YYYY-MM-DD` (or a Date) as local midnight. Prefer this over
// `new Date("YYYY-MM-DD")` for due-date comparisons — UTC midnight shifts a
// day west of the Atlantic. (Not the same as csv-import's parseDateOnly,
// which normalizes free-text → YYYY-MM-DD string.)
export function toLocalDate(d: string | Date): Date {
  if (d instanceof Date) {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    return out;
  }
  return new Date(d + "T00:00:00");
}

// True when `due` is on or before today + `withinDays` (inclusive).
// Missing due dates never count as "due soon".
export function isDueWithinDays(
  due: string | null | undefined,
  withinDays: number,
  from: Date = new Date(),
): boolean {
  if (!due) return false;
  const dueDate = toLocalDate(due);
  const end = toLocalDate(from);
  end.setDate(end.getDate() + withinDays);
  return dueDate.getTime() <= end.getTime();
}

// Today + N days as YYYY-MM-DD (local). Used for to-do default due dates.
export function daysFromNow(days: number, from: Date = new Date()): string {
  return toDateString(addDays(toLocalDate(from), days));
}

export function durationMinutes(
  startedAt: string,
  endedAt: string | null,
): number {
  if (!endedAt) return 0;
  return Math.round(
    (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000,
  );
}

// Whole days from `from` to `due`; negative when overdue. The shared basis for
// every due-date urgency read (labels in this file, tones in lib/due.ts).
export function daysUntil(due: string, from: Date = new Date()): number {
  return Math.round(
    (toLocalDate(due).getTime() - toLocalDate(from).getTime()) / 86400000,
  );
}

// "in 12d" / "3d overdue" / "today" — the at-a-glance urgency label next to a
// due date. Empty string for no date so callers can render nothing.
export function relativeDueLabel(
  due: string | null | undefined,
  from: Date = new Date(),
): string {
  if (!due) return "";
  const n = daysUntil(due, from);
  if (n === 0) return "today";
  if (n < 0) return `${-n}d overdue`;
  if (n < 45) return `in ${n}d`;
  return `in ${Math.round(n / 7)}w`;
}

// "2026-08-12" → "Aug 12" (compact milestone dates in lists).
export function formatDateShort(d: string | null | undefined): string {
  if (!d) return "—";
  const date = toLocalDate(d);
  return `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`;
}
