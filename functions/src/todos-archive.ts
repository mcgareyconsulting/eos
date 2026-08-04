/**
 * Pure selection rules for the Monday archive sweep.
 * Keep in sync with ../../lib/todos-archive.ts
 */

export type TodoArchiveCandidate = {
  id: string;
  source_rock_id?: string | null;
  archived_at?: unknown | null;
  completed_at?: { toMillis?: () => number } | null;
  visibility?: string | null;
};

function isPureActiveCompleted(
  t: TodoArchiveCandidate,
): t is TodoArchiveCandidate & { completed_at: { toMillis: () => number } } {
  if (t.archived_at != null) return false;
  if (t.source_rock_id) return false;
  if (t.completed_at == null) return false;
  if (typeof t.completed_at.toMillis !== "function") return false;
  return true;
}

// Private to-dos ARE included here — the sweep is their only auto-archive
// path (Finish-time archiving in lib/todos-archive.ts deliberately skips them).
export function selectTodosCompletedBeforeWeek(
  todos: TodoArchiveCandidate[],
  weekStartMs: number,
): string[] {
  if (!Number.isFinite(weekStartMs)) return [];
  return todos
    .filter(isPureActiveCompleted)
    .filter((t) => t.completed_at.toMillis() < weekStartMs)
    .map((t) => t.id);
}

export type IssueArchiveCandidate = {
  id: string;
  status?: string | null;
  archived_at?: unknown | null;
  resolved_at?: { toMillis?: () => number } | null;
};

const CLOSED_ISSUE = new Set(["solved", "dropped"]);

function isActiveClosedIssue(
  i: IssueArchiveCandidate,
): i is IssueArchiveCandidate & { resolved_at: { toMillis: () => number } } {
  if (i.archived_at != null) return false;
  if (!CLOSED_ISSUE.has(String(i.status ?? ""))) return false;
  if (i.resolved_at == null || typeof i.resolved_at.toMillis !== "function") {
    return false;
  }
  return true;
}

export function selectIssuesClosedBeforeWeek(
  issues: IssueArchiveCandidate[],
  weekStartMs: number,
): string[] {
  if (!Number.isFinite(weekStartMs)) return [];
  return issues
    .filter(isActiveClosedIssue)
    .filter((i) => i.resolved_at.toMillis() < weekStartMs)
    .map((i) => i.id);
}

export type HeadlineArchiveCandidate = {
  id: string;
  discussed?: boolean | null;
  discussed_at?: { toMillis?: () => number } | null;
  archived_at?: unknown | null;
  broadcast?: boolean | null;
};

function isActiveDiscussedHeadline(
  h: HeadlineArchiveCandidate,
): h is HeadlineArchiveCandidate & {
  discussed_at: { toMillis: () => number };
} {
  if (h.archived_at != null) return false;
  if (h.broadcast) return false;
  if (h.discussed !== true) return false;
  if (
    h.discussed_at == null ||
    typeof h.discussed_at.toMillis !== "function"
  ) {
    return false;
  }
  return true;
}

export function selectHeadlinesDiscussedBeforeWeek(
  headlines: HeadlineArchiveCandidate[],
  weekStartMs: number,
): string[] {
  if (!Number.isFinite(weekStartMs)) return [];
  return headlines
    .filter(isActiveDiscussedHeadline)
    .filter((h) => h.discussed_at.toMillis() < weekStartMs)
    .map((h) => h.id);
}

const WEEKDAY_TO_MONDAY_OFFSET: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export function mondayMidnightMsInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): number {
  const parts = zonedParts(timeZone, now);
  const offsetDays = WEEKDAY_TO_MONDAY_OFFSET[parts.weekday];
  if (offsetDays === undefined) {
    throw new Error(`Unexpected weekday label: ${parts.weekday}`);
  }
  const monday = addCivilDays(
    { year: parts.year, month: parts.month, day: parts.day },
    -offsetDays,
  );
  return zonedCivilTimeToUtcMs(
    timeZone,
    monday.year,
    monday.month,
    monday.day,
    0,
    0,
    0,
  );
}

type CivilDate = { year: number; month: number; day: number };

function zonedParts(
  timeZone: string,
  date: Date,
): CivilDate & {
  weekday: string;
  hour: number;
  minute: number;
  second: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    weekday: bag.weekday,
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

function addCivilDays(d: CivilDate, delta: number): CivilDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + delta, 12, 0, 0));
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
  };
}

function zonedCivilTimeToUtcMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const wall = zonedParts(timeZone, new Date(utcGuess));
    const asUtc = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    const diff = asUtc - desired;
    if (diff === 0) break;
    utcGuess -= diff;
  }
  return utcGuess;
}
