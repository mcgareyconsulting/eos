// How one row of a team's meeting history reads (the Meetings page,
// app/(app)/teams/[teamId]/meetings/meetings-list.tsx): live or completed,
// how long it ran, which agenda, and where a live one is. Pure, and shared
// with the admin export (lib/export/pages/meetings.ts) so the list and the
// file can't drift.

import { agendaSegmentList, defaultL10Items, type AgendaItem } from "./agenda";
import { SEGMENT_LABELS, normalizeSegment } from "./segments";

// Timestamps arrive two ways: serialized to millis by the server render
// (initial), and as Firestore Timestamps from onSnapshot. Normalize both.
export type TsLike = { toMillis?: () => number } | number | null | undefined;

export function toMs(v: TsLike): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  return v.toMillis?.() ?? null;
}

export type MeetingSummaryInput = {
  started_at: TsLike;
  ended_at: TsLike;
  current_segment: string;
  agenda_name?: string | null;
  agenda_items?: AgendaItem[] | null;
};

export type MeetingSummary = {
  startedMs: number | null;
  endedMs: number | null;
  live: boolean;
  /** Whole minutes, at least 1; null while live. */
  durationMin: number | null;
  agendaName: string | null;
  /** "Completed · 62 min · Level 10", "In progress · Step 3 of 7 · Scorecard". */
  progressLabel: string;
};

/**
 * The team's average effectiveness rating, to one decimal, from the raw
 * `effectiveness_scores` values; null when nobody rated (or nothing valid).
 */
export function averageRating(ratings: readonly unknown[]): number | null {
  const valid = ratings.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((s, n) => s + n, 0) / valid.length) * 10) / 10;
}

/** Newest first, as the list renders. */
export function sortMeetingsNewestFirst<T extends { started_at: TsLike }>(meetings: readonly T[]): T[] {
  return [...meetings].sort((a, b) => (toMs(b.started_at) ?? 0) - (toMs(a.started_at) ?? 0));
}

export function meetingSummary(m: MeetingSummaryInput): MeetingSummary {
  const startedMs = toMs(m.started_at);
  const endedMs = toMs(m.ended_at);
  const live = endedMs == null;
  // Floor at 1 to match the detail page/recap — a 30-second test run
  // should read "1 min" in both places, not "0 min" here.
  const durationMin =
    startedMs != null && endedMs != null
      ? Math.max(1, Math.round((endedMs - startedMs) / 60000))
      : null;

  const agendaOrder = agendaSegmentList(
    m.agenda_items?.length ? m.agenda_items : defaultL10Items(),
  );
  const segmentCount = agendaOrder.length;
  const segment = normalizeSegment(m.current_segment as string);
  const segIdx = segment && segment !== "done" ? agendaOrder.indexOf(segment) : -1;
  const stepNumber = live && segIdx >= 0 ? Math.min(segIdx + 1, segmentCount) : null;
  const agendaName =
    typeof m.agenda_name === "string" && m.agenda_name.trim() ? m.agenda_name.trim() : null;
  const progressLabel = live
    ? stepNumber != null && segment
      ? `In progress · Step ${stepNumber} of ${segmentCount} · ${SEGMENT_LABELS[segment]}${
          agendaName ? ` · ${agendaName}` : ""
        }`
      : agendaName
        ? `In progress · ${agendaName}`
        : "In progress"
    : `Completed · ${durationMin ?? "—"} min${agendaName ? ` · ${agendaName}` : ""}`;

  return { startedMs, endedMs, live, durationMin, agendaName, progressLabel };
}
