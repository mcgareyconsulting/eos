// Activity feed — the pure half of components/activity-feed.tsx.
//
// One newest-first timeline per item (rock, to-do, issue, headline) that
// mixes two kinds of row:
//
//   - comments (`entity_comments`, the same thread EntityComments shows), and
//   - events: what happened to the item. Events come from more than one
//     place, so they are normalised into one `FeedEvent` shape here:
//       · the to-do activity trace (`entity_activity`, lib/activity.ts) —
//         to-dos only, which also covers a rock's milestones (a milestone is
//         a to-do with `source_rock_id`);
//       · a rock's status history (`rock_status_updates`, status + note);
//       · anything else a caller already holds, passed straight in.
//
// Nothing here touches Firestore or React, so the merge/sort rules and the
// sentence each event renders as are unit-tested (activity-feed.test.ts).

import {
  activityVerb,
  SYSTEM_ACTOR_ID,
  type ActivityKind,
} from "./activity";

/** Firestore Timestamp, epoch millis, or a pending server timestamp. */
export type MaybeTimestamp =
  | { toMillis: () => number }
  | number
  | null
  | undefined;

export function tsMs(t: MaybeTimestamp): number | null {
  if (t == null) return null;
  if (typeof t === "number") return t;
  return typeof t.toMillis === "function" ? t.toMillis() : null;
}

/** The item types a feed can sit on — the comment thread types. */
export type FeedEntityType = "rock" | "todo" | "issue" | "headline";

const NOUN: Record<FeedEntityType, string> = {
  rock: "rock",
  todo: "to-do",
  issue: "issue",
  headline: "headline",
};

export function feedEntityNoun(type: FeedEntityType): string {
  return NOUN[type];
}

/**
 * Event kinds the feed knows how to say. The to-do trace's own kinds pass
 * through unchanged; the rest are for events that come from elsewhere.
 */
export type FeedEventKind =
  | ActivityKind
  /** A status change; `status` names the new one, `detail` is the note. */
  | "status_changed"
  /** A milestone ticked / unticked; `subject` is the milestone's title. */
  | "milestone_completed"
  | "milestone_reopened"
  /** `detail` carries "Old → New" when the caller has it. */
  | "owner_changed"
  | "due_changed"
  /** Issue solved / reopened. */
  | "solved"
  | "unsolved";

export type FeedEvent = {
  /** Unique within the feed; prefixed by source so ids never collide. */
  id: string;
  kind: FeedEventKind;
  /** Null when no person caused it (a sweep) or the source didn't say. */
  actorId: string | null;
  /** Shown when the actor isn't the viewer. */
  actorName: string;
  /** Epoch millis, or null for a server timestamp that hasn't resolved. */
  ms: number | null;
  /** Second line: a status note, an edit summary, a comment snippet. */
  detail?: string | null;
  /** The thing acted on inside the item (a milestone's title). */
  subject?: string | null;
  /** For `status_changed`: the raw status value and its label. */
  status?: { value: string; label: string } | null;
  /** Overrides the built-in sentence for a kind the caller invents. */
  verb?: string;
};

/** The fields of a comment the feed needs (CommentDoc in the component). */
export type FeedComment = {
  id: string;
  author_id: string;
  body: string;
  created_at: MaybeTimestamp;
};

export type FeedItem<C extends FeedComment = FeedComment> =
  | { type: "comment"; key: string; ms: number | null; comment: C }
  | { type: "event"; key: string; ms: number | null; event: FeedEvent };

/**
 * Trace kinds that only mirror a comment. The comment itself is already in
 * the feed, so its `commented` row would say the same thing twice.
 * `comment_deleted` stays: the comment row is gone and the trace is the only
 * record that it existed.
 */
const MIRRORS_A_COMMENT: ReadonlySet<FeedEventKind> = new Set(["commented"]);

/**
 * Comments and events, newest first.
 *
 * A null time is a server timestamp still in flight — something that was
 * just written, so it sorts as the newest (the same rule EntityActivity
 * uses), not the oldest. Ties fall back to the key so the order is stable
 * across snapshots: a live listener re-delivering the same rows must not
 * shuffle them.
 */
export function mergeTimeline<C extends FeedComment>(
  comments: readonly C[],
  events: readonly FeedEvent[],
): FeedItem<C>[] {
  const items: FeedItem<C>[] = [];
  for (const c of comments) {
    items.push({
      type: "comment",
      key: `comment:${c.id}`,
      ms: tsMs(c.created_at),
      comment: c,
    });
  }
  const seen = new Set<string>();
  for (const e of events) {
    if (MIRRORS_A_COMMENT.has(e.kind)) continue;
    const key = `event:${e.id}`;
    // Two sources can hand over the same row (a caller's snapshot and the
    // live listener); the first copy wins.
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: "event", key, ms: e.ms, event: e });
  }
  return items.sort(compareNewestFirst);
}

function compareNewestFirst(
  a: { ms: number | null; key: string },
  b: { ms: number | null; key: string },
): number {
  const am = a.ms ?? Number.MAX_SAFE_INTEGER;
  const bm = b.ms ?? Number.MAX_SAFE_INTEGER;
  if (am !== bm) return bm - am;
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

// ---------- adapters: source rows → FeedEvent ----------

/** An `entity_activity` row as a client listener delivers it. */
export type ActivityRowLike = {
  id: string;
  entity_id?: string;
  kind: ActivityKind;
  actor_id: string;
  actor_name: string;
  detail: string | null;
  created_at: MaybeTimestamp;
};

/** The to-do's own trace, as feed events. */
export function eventsFromActivity(
  rows: readonly ActivityRowLike[],
): FeedEvent[] {
  return rows.map((r) => ({
    id: `activity:${r.id}`,
    kind: r.kind,
    actorId: r.actor_id,
    actorName: r.actor_name,
    ms: tsMs(r.created_at),
    detail: r.detail,
  }));
}

/**
 * A rock's milestones' traces, as rock events. Only ticks and unticks are a
 * rock's business; edits, follows and comments on a milestone stay on the
 * milestone. Rows for a milestone not in `titleById` (deleted, or moved off
 * the rock) are dropped.
 */
export function milestoneEventsFromActivity(
  rows: readonly ActivityRowLike[],
  titleById: ReadonlyMap<string, string>,
): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const r of rows) {
    if (r.kind !== "completed" && r.kind !== "reopened") continue;
    const milestoneId = r.entity_id ?? "";
    const title = titleById.get(milestoneId);
    if (title === undefined) continue;
    out.push({
      id: `milestone:${r.id}`,
      kind: r.kind === "completed" ? "milestone_completed" : "milestone_reopened",
      actorId: r.actor_id,
      actorName: r.actor_name,
      ms: tsMs(r.created_at),
      subject: title,
    });
  }
  return out;
}

/** A `rock_status_updates` entry as the rocks page serialises it. */
export type StatusUpdateLike = {
  id: string;
  status: string;
  comment: string | null;
  user_id: string | null;
  created_at_ms: number | null;
  author_name: string;
};

/**
 * Status history as feed events — the note left with the change is the
 * event's detail, so the Status history section folds into the feed.
 */
export function eventsFromStatusHistory(
  updates: readonly StatusUpdateLike[],
  labelOf: (status: string) => string = (s) => s,
): FeedEvent[] {
  return updates.map((u) => ({
    id: `status:${u.id}`,
    kind: "status_changed",
    actorId: u.user_id,
    actorName: u.author_name,
    ms: u.created_at_ms,
    detail: u.comment?.trim() || null,
    status: { value: u.status, label: labelOf(u.status) },
  }));
}

// ---------- event → words ----------

export type EventSentence = {
  /** Bolded lead ("You", "Steph Benes"); null when no person did it. */
  actor: string | null;
  /** The rest of the sentence, already noun-aware. */
  text: string;
};

function quoted(s: string | null | undefined): string {
  const t = s?.trim();
  return t ? ` “${t}”` : "";
}

/** What follows the actor's name. `noun` overrides the entity's ("milestone"
 *  for a to-do that hangs off a rock). */
export function feedEventVerb(
  e: FeedEvent,
  entity: FeedEntityType,
  noun: string = feedEntityNoun(entity),
): string {
  if (e.verb) return e.verb;
  switch (e.kind) {
    case "created":
      return `created this ${noun}`;
    case "status_changed":
      return e.status ? `set the status to ${e.status.label}` : "changed the status";
    case "milestone_completed":
      return `completed the milestone${quoted(e.subject)}`;
    case "milestone_reopened":
      return `reopened the milestone${quoted(e.subject)}`;
    case "owner_changed":
      return "changed the owner";
    case "due_changed":
      return "changed the due date";
    case "solved":
      return "solved it";
    case "unsolved":
      return "reopened it";
    default:
      return activityVerb(e.kind);
  }
}

/**
 * The line a feed event renders as. The viewer reads as "You"; an automatic
 * sweep has no person to name, so its sentence stands on its own
 * ("Archived automatically").
 */
export function feedEventSentence(
  e: FeedEvent,
  entity: FeedEntityType,
  viewerId: string,
  noun?: string,
): EventSentence {
  if (e.actorId === SYSTEM_ACTOR_ID) {
    if (e.kind === "archived" && !e.verb) {
      return { actor: null, text: "Archived automatically" };
    }
    return { actor: null, text: capitalize(feedEventVerb(e, entity, noun)) };
  }
  const actor =
    e.actorId != null && e.actorId === viewerId
      ? "You"
      : e.actorName.trim() || "Someone";
  return { actor, text: feedEventVerb(e, entity, noun) };
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "3 comments · 5 updates" — the count under the feed's heading. */
export function feedCountLabel(items: readonly FeedItem[]): string {
  let comments = 0;
  let events = 0;
  for (const i of items) {
    if (i.type === "comment") comments++;
    else events++;
  }
  const parts: string[] = [];
  if (comments > 0) parts.push(`${comments} comment${comments === 1 ? "" : "s"}`);
  if (events > 0) parts.push(`${events} update${events === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
