// Issue events for the detail modal's activity feed.
//
// Issues have no activity trace yet (only to-dos write `entity_activity`),
// so the feed shows only what the issue document itself can prove: when it
// was created and by whom, and — while it is still solved, dropped or
// archived — when that happened. Nothing here invents history: an event is
// emitted only when its timestamp is on the doc, and an actor is named only
// when the doc says who it was.
//
// TODO(activity-rules): owner changes, term moves (short ↔ long), votes,
// status moves to Solving / reopenings, and edits need a recorded trace
// (recordActivity for issues + an `entity_activity` read rule for
// entity_type "issue"). Those events plug in next to these, via the feed's
// `events` prop or a live listener like the to-do's.

import type { FeedEvent } from "@/lib/activity-feed";
import type { IssueStatus } from "@/lib/issues";

/**
 * The fields of an issue doc the events are read from. All optional: the
 * server-rendered first paint carries none of them (Timestamps don't cross
 * to the client), the live listener's docs carry whatever was written, and
 * older or imported docs may lack `created_by`.
 */
export type IssueEventSource = {
  id: string;
  status?: IssueStatus | null;
  created_at?: unknown;
  created_by?: string | null;
  /** Set when the issue is solved or dropped; cleared when it reopens. */
  resolved_at?: unknown;
  /** Set when the issue is archived; cleared when it is restored. */
  archived_at?: unknown;
  /** The audit stamp — the last writer and when. */
  updated_at?: unknown;
  updated_by?: string | null;
};

/**
 * Epoch millis from a Firestore Timestamp or a number. Anything else — null,
 * a field the server prefetch flattened to `true`, a pending server
 * timestamp — is "no time", and the event that needed it is left out rather
 * than shown as "just now".
 */
export function issueTimeMs(t: unknown): number | null {
  if (typeof t === "number") return Number.isFinite(t) ? t : null;
  if (t != null && typeof t === "object") {
    const toMillis = (t as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") {
      const ms = (toMillis as () => unknown).call(t);
      return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
    }
  }
  return null;
}

/**
 * Who wrote the field stamped at `ms`, if the doc can say. Every issue write
 * stamps `updated_by` / `updated_at` in the same write as the field it sets,
 * and server timestamps in one write share one commit time — so when
 * `updated_at` still equals that field's time, nothing has touched the issue
 * since and `updated_by` is the person who did it. Any later write (an edit,
 * a vote, a term move) moves `updated_at` on and the actor is unknown. The
 * comment counter (`comment_count`, lib/firebase/issue-comment-count.ts) is
 * written without a stamp for exactly this reason: a comment must not turn
 * the person who solved or archived the issue into "Someone".
 */
function actorAt(issue: IssueEventSource, ms: number): string | null {
  const stampMs = issueTimeMs(issue.updated_at);
  return stampMs === ms && issue.updated_by ? issue.updated_by : null;
}

function actorName(
  actorId: string | null,
  nameOf: (uid: string) => string | null | undefined,
): string {
  // An unknown or off-roster actor reads as "Someone" in the feed.
  return actorId ? (nameOf(actorId)?.trim() ?? "") : "";
}

/**
 * The events the issue doc can prove, for `<ActivityFeed events>`.
 *
 * - created — `created_at`, by `created_by`;
 * - solved / dropped — `resolved_at`, while the status is still solved or
 *   dropped (reopening clears it, so a reopened issue has no such event);
 * - archived — `archived_at`, while the issue is still archived.
 */
export function issueEventsFromDoc(
  issue: IssueEventSource,
  nameOf: (uid: string) => string | null | undefined,
): FeedEvent[] {
  const events: FeedEvent[] = [];

  const createdMs = issueTimeMs(issue.created_at);
  if (createdMs != null) {
    const actorId = issue.created_by || null;
    events.push({
      id: `issue:${issue.id}:created`,
      kind: "created",
      actorId,
      actorName: actorName(actorId, nameOf),
      ms: createdMs,
    });
  }

  const resolvedMs = issueTimeMs(issue.resolved_at);
  if (
    resolvedMs != null &&
    (issue.status === "solved" || issue.status === "dropped")
  ) {
    const actorId = actorAt(issue, resolvedMs);
    events.push({
      id: `issue:${issue.id}:${issue.status}`,
      ...(issue.status === "solved"
        ? { kind: "solved" as const }
        : { kind: "updated" as const, verb: "dropped it" }),
      actorId,
      actorName: actorName(actorId, nameOf),
      ms: resolvedMs,
    });
  }

  const archivedMs = issueTimeMs(issue.archived_at);
  if (archivedMs != null) {
    const actorId = actorAt(issue, archivedMs);
    events.push({
      id: `issue:${issue.id}:archived`,
      kind: "archived",
      actorId,
      actorName: actorName(actorId, nameOf),
      ms: archivedMs,
    });
  }

  return events;
}
