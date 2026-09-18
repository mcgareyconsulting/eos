// Per-entity activity trace — the pure half.
//
// One row per *event* on an entity (created, edited, checked off, followed,
// commented on…), written by the same server actions that fan out
// notifications. Where a notification is one recipient's copy of an event,
// an activity row is the event itself: it is written whether or not anyone
// is told, so the trace is complete even for a to-do nobody follows.
//
// Why not the audit_log? It is admin-only, and every to-do write goes
// through a server action (Admin SDK), so its `actor_uid` is null for
// exactly the rows this feed cares about. This trace records the actor at
// the one place that knows them.
//
// Firestore writes live in lib/firebase/activity.ts.

import type { NotificationEntityType } from "@/lib/notifications";

/** Same union as notifications: an entity is traced iff it can be followed. */
export type ActivityEntityType = NotificationEntityType;

export type ActivityKind =
  | "created"
  /** Title / owner / due date (/ priority / term) changed — `detail` carries the summary. */
  | "updated"
  | "description"
  /** A to-do checked off, or an issue solved. */
  | "completed"
  | "reopened"
  /** Issue only: dropped, and taken up (status Solving). */
  | "dropped"
  | "solving"
  /** Issue only: moved between the short-term list and long-term. */
  | "term_short"
  | "term_long"
  | "archived"
  | "restored"
  | "weekly_focus_on"
  | "weekly_focus_off"
  /** The actor followed / unfollowed on their own behalf. */
  | "followed"
  | "unfollowed"
  /** The actor added / removed other people — `detail` names them. */
  | "followers_added"
  | "followers_removed"
  /** `detail` carries the comment snippet. */
  | "commented"
  | "comment_deleted";

/** Stored shape of an `/entity_activity/{id}` row. */
export type ActivityDoc = {
  team_id: string;
  entity_type: ActivityEntityType;
  entity_id: string;
  /**
   * Copied from the entity so the read rule can gate a private to-do's
   * trace to its owner without a lookup. Recorded at write time: a private
   * to-do that is later reassigned keeps its earlier rows with the earlier
   * owner, so they stay hidden from the new one. Issues have no private
   * form and always write "team".
   */
  visibility: "team" | "private";
  owner_id: string | null;
  kind: ActivityKind;
  actor_id: string;
  actor_name: string;
  detail: string | null;
  created_at: unknown;
};

/**
 * The sentence the feed shows after the actor's name (rendered bold).
 * Rows written before issues existed carry no `entity_type`; they are
 * to-dos, and the default keeps their wording.
 */
export function activityVerb(
  kind: ActivityKind,
  entityType: ActivityEntityType = "todo",
): string {
  const issue = entityType === "issue";
  switch (kind) {
    case "created":
      return issue ? "raised this issue" : "created this to-do";
    case "updated":
      return "updated";
    case "description":
      return "updated the description";
    case "completed":
      return issue ? "solved it" : "completed it";
    case "reopened":
      return "reopened it";
    case "dropped":
      return "dropped it";
    case "solving":
      return "started solving it";
    case "term_short":
      return "moved it to short-term";
    case "term_long":
      return "moved it to long-term";
    case "archived":
      return "archived it";
    case "restored":
      return "restored it to Active";
    case "weekly_focus_on":
      return "marked it as this week's focus";
    case "weekly_focus_off":
      return "removed the weekly focus";
    case "followed":
      return "started following";
    case "unfollowed":
      return "stopped following";
    case "followers_added":
      return "added followers";
    case "followers_removed":
      return "removed followers";
    case "commented":
      return "commented";
    case "comment_deleted":
      return "deleted a comment";
  }
}

/** "Steph Benes, Casey Nolan" — names for a `followers_*` detail line. */
export function joinNames(
  ids: readonly string[],
  nameOf: (uid: string) => string | null | undefined,
): string | null {
  const names = ids.map((id) => nameOf(id)?.trim() || "—");
  return names.length > 0 ? names.join(", ") : null;
}
