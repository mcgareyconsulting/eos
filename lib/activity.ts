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

export type ActivityEntityType = "todo";

export type ActivityKind =
  | "created"
  /** Title / owner / due date changed — `detail` carries the summary. */
  | "updated"
  | "description"
  | "completed"
  | "reopened"
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
   * owner, so they stay hidden from the new one.
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
 * Actor for rows no person caused — the Finish and Monday archive sweeps.
 * The feed renders these without a name ("Archived automatically").
 */
export const SYSTEM_ACTOR_ID = "system";

export type AutoArchiveReason = "finish" | "monday";

/**
 * The `archived` row an automatic sweep writes, so the trace says why a
 * to-do left Active without anyone touching it. `createdAt` is the caller's
 * server timestamp — the app and the Functions bundle each bring their own
 * firebase-admin.
 */
export function autoArchiveActivity(
  todo: {
    id: string;
    team_id: string;
    visibility?: string | null;
    owner_id?: string | null;
  },
  reason: AutoArchiveReason,
  createdAt: unknown,
): ActivityDoc {
  return {
    team_id: todo.team_id,
    entity_type: "todo",
    entity_id: todo.id,
    visibility: todo.visibility === "private" ? "private" : "team",
    owner_id: todo.owner_id || null,
    kind: "archived",
    actor_id: SYSTEM_ACTOR_ID,
    actor_name: "EOS",
    detail:
      reason === "finish"
        ? "Closed out when the L10 finished"
        : "Closed out by the Monday sweep",
    created_at: createdAt,
  };
}

/** The sentence the feed shows after the actor's name (rendered bold). */
export function activityVerb(kind: ActivityKind): string {
  switch (kind) {
    case "created":
      return "created this to-do";
    case "updated":
      return "updated";
    case "description":
      return "updated the description";
    case "completed":
      return "completed it";
    case "reopened":
      return "reopened it";
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
