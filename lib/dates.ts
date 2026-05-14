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

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}
