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

// "2026-05-18" → "5/18/2026" (or whatever the browser's locale format is).
// Parses with a local-midnight anchor so a date-only string never rolls back
// a day west of UTC (`new Date("2026-05-18")` parses as UTC midnight, which
// renders as the previous day in US timezones).
export function formatDateOnly(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString();
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
