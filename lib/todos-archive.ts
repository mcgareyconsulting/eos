// Pure rules for when a pure to-do should leave Active → Archived.
// Used by endMeeting (in-meeting completions) and the Monday morning sweep
// (prior-week leftovers). Keep selection logic out of server actions so it
// can be unit-tested without Firestore.

export type TodoArchiveCandidate = {
  id: string;
  source_rock_id?: string | null;
  archived_at?: unknown | null;
  completed_at?: { toMillis?: () => number } | null;
};

export function isPureActiveCompleted(
  t: TodoArchiveCandidate,
): t is TodoArchiveCandidate & {
  completed_at: { toMillis: () => number };
} {
  if (t.archived_at != null) return false;
  if (t.source_rock_id) return false;
  if (t.completed_at == null) return false;
  if (typeof t.completed_at.toMillis !== "function") return false;
  return true;
}

/**
 * Archive when the L10 finishes: pure to-dos completed during this meeting's
 * window (started_at → endMs). Items completed earlier in the week stay on
 * Active (checked) until the Monday morning sweep.
 */
export function selectTodosCompletedDuringMeeting(
  todos: TodoArchiveCandidate[],
  meetingStartMs: number,
  meetingEndMs: number,
): string[] {
  if (!Number.isFinite(meetingStartMs) || !Number.isFinite(meetingEndMs)) {
    return [];
  }
  // Small grace so a checkbox right before Finish still counts.
  const end = meetingEndMs + 60_000;
  return todos
    .filter(isPureActiveCompleted)
    .filter((t) => {
      const c = t.completed_at.toMillis();
      return c >= meetingStartMs && c <= end;
    })
    .map((t) => t.id);
}

/**
 * Monday ~3am sweep: pure to-dos that were completed *before* this week's
 * Monday 00:00 local (i.e. closed last week or earlier) and still sit on
 * Active. Leaves "done this week" visible until next Monday.
 *
 * @param weekStartMs — local Monday 00:00 of the current week, as ms epoch
 */
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

// --- Issues (closed = solved | dropped; clock = resolved_at) ---------------

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

export function selectIssuesClosedDuringMeeting(
  issues: IssueArchiveCandidate[],
  meetingStartMs: number,
  meetingEndMs: number,
): string[] {
  if (!Number.isFinite(meetingStartMs) || !Number.isFinite(meetingEndMs)) {
    return [];
  }
  const end = meetingEndMs + 60_000;
  return issues
    .filter(isActiveClosedIssue)
    .filter((i) => {
      const c = i.resolved_at.toMillis();
      return c >= meetingStartMs && c <= end;
    })
    .map((i) => i.id);
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

// --- Headlines (closed = discussed; standing never auto-archive) -----------

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

/** Finish: discussed *during this meeting* only (not mid-week checks). */
export function selectHeadlinesDiscussedDuringMeeting(
  headlines: HeadlineArchiveCandidate[],
  meetingStartMs: number,
  meetingEndMs: number,
): string[] {
  if (!Number.isFinite(meetingStartMs) || !Number.isFinite(meetingEndMs)) {
    return [];
  }
  const end = meetingEndMs + 60_000;
  return headlines
    .filter(isActiveDiscussedHeadline)
    .filter((h) => {
      const c = h.discussed_at.toMillis();
      return c >= meetingStartMs && c <= end;
    })
    .map((h) => h.id);
}

/** Monday: discussed before this week, still on Active. */
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

/**
 * Epoch ms for Monday 00:00:00 in `timeZone` of the week containing `now`.
 * Used by the Cloud Scheduler job (America/Chicago) so "last week" matches
 * the bank's calendar, not the container's UTC clock.
 */
export function mondayMidnightMsInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): number {
  const parts = zonedParts(timeZone, now);
  const offsetDays = WEEKDAY_TO_MONDAY_OFFSET[parts.weekday];
  if (offsetDays === undefined) {
    throw new Error(`Unexpected weekday label: ${parts.weekday}`);
  }

  // Walk back to Monday on the civil calendar in that zone.
  const monday = addCivilDays(
    { year: parts.year, month: parts.month, day: parts.day },
    -offsetDays,
  );
  return zonedCivilTimeToUtcMs(timeZone, monday.year, monday.month, monday.day, 0, 0, 0);
}

type CivilDate = { year: number; month: number; day: number };

function zonedParts(
  timeZone: string,
  date: Date,
): CivilDate & { weekday: string; hour: number; minute: number; second: number } {
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
  // Noon UTC avoids DST edge cases when only the calendar day matters.
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + delta, 12, 0, 0));
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
  };
}

/**
 * Convert a civil date-time in `timeZone` to UTC epoch ms.
 * One-step correction from a UTC guess using the zone's wall clock.
 */
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
