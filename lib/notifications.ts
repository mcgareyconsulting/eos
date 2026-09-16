// In-app notifications — the pure half.
//
// One model over `entity_type`, per the N31/N61 decision: a *follow* is a
// list of uids on the entity doc (`follower_ids`), and an *event* on that
// entity fans out one `notifications` row per follower who did not cause it.
// To-dos are the first (and for now only) entity wired up; issues get the
// same shape once the subscribe-vs-broadcast question N31 is waiting on is
// answered. Nothing here sends email — the bell replaces that volume, it
// does not add to it.
//
// Firestore writes live in lib/firebase/notifications.ts. This file is the
// part worth unit-testing: who follows what, who gets told, and what the row
// says.

export type NotificationEntityType = "todo";

export type NotificationKind =
  /** Someone commented on an entity you follow. */
  | "comment"
  /** Someone @mentioned you in a comment (supersedes `comment`). */
  | "mention"
  /** An entity you follow was checked off. */
  | "completed"
  /** …and un-checked again. */
  | "reopened"
  /** Title / owner / due date changed on an entity you follow. */
  | "updated"
  /** You were made the owner. */
  | "assigned"
  /** Someone added you as a follower when they created the to-do. */
  | "following";

/** Stored shape of a `/notifications/{id}` row. */
export type NotificationDoc = {
  /** Recipient. Rules key reads on this. */
  user_id: string;
  team_id: string;
  team_name: string;
  entity_type: NotificationEntityType;
  entity_id: string;
  /** Denormalised so the hub never has to fetch the entity to say its name. */
  entity_title: string;
  kind: NotificationKind;
  actor_id: string;
  actor_name: string;
  /** Comment snippet or change summary; null when the kind says it all. */
  detail: string | null;
  created_at: unknown;
  read_at: unknown;
  /** Set by the hub's ✕ / "Archive read"; absent on rows older than the tab. */
  archived_at: unknown;
};

// ---------------------------------------------------------------------------
// Follow relation
// ---------------------------------------------------------------------------

function uniq(ids: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id === "string" && id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Followers a brand-new to-do starts with: whoever created it, whoever it
 * was assigned to, and anyone the creator picked under "Add followers".
 * Creating a to-do for yourself yields one follower, not two copies of you;
 * naming the owner again as a follower does not double them either.
 */
export function initialFollowers(args: {
  creatorId: string;
  ownerId: string | null | undefined;
  /** Explicit picks from the Add to-do form; already roster-validated. */
  extraIds?: readonly (string | null | undefined)[];
}): string[] {
  return uniq([args.creatorId, args.ownerId, ...(args.extraIds ?? [])]);
}

/**
 * The people an "added you as a follower" row goes to: the explicit picks
 * minus the creator (their own action) and the owner (they get `assigned`
 * instead, or made the to-do themselves).
 */
export function addedFollowerRecipients(args: {
  creatorId: string;
  ownerId: string | null | undefined;
  extraIds: readonly string[];
}): string[] {
  return uniq(args.extraIds).filter(
    (id) => id !== args.creatorId && id !== args.ownerId,
  );
}

/**
 * Followers after a reassignment. The new owner starts following; the old
 * owner keeps following — they handed it off, they still want to know it
 * got done, and an explicit Unfollow is one click if not.
 */
export function followersAfterOwnerChange(
  current: readonly string[] | null | undefined,
  nextOwnerId: string | null | undefined,
): string[] {
  return uniq([...(current ?? []), nextOwnerId]);
}

/**
 * Followers after the Edit form's picker is saved. The owner always
 * follows; everyone else is exactly who was left checked. A private to-do
 * is its owner's alone, so the picks are dropped for one. Returns who was
 * added and removed so the caller can notify the former and record both.
 */
export function applyFollowerEdit(args: {
  current: readonly string[] | null | undefined;
  ownerId: string | null | undefined;
  picked: readonly string[];
  visibility: "team" | "private" | string | null | undefined;
}): { next: string[]; added: string[]; removed: string[] } {
  const before = uniq(args.current ?? []);
  const next =
    args.visibility === "private"
      ? uniq([args.ownerId])
      : uniq([args.ownerId, ...args.picked]);
  return {
    next,
    added: next.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !next.includes(id)),
  };
}

/** Add or remove one uid — the Follow / Unfollow toggle. */
export function toggleFollower(
  current: readonly string[] | null | undefined,
  uid: string,
  following: boolean,
): string[] {
  const base = uniq(current ?? []);
  if (following) return base.includes(uid) ? base : [...base, uid];
  return base.filter((id) => id !== uid);
}

// ---------------------------------------------------------------------------
// Who gets told
// ---------------------------------------------------------------------------

export type RecipientArgs = {
  followerIds: readonly string[] | null | undefined;
  /** Never notified about their own action. */
  actorId: string;
  /** A private to-do is readable by its owner only, so only they can be told. */
  visibility: "team" | "private" | string | null | undefined;
  ownerId: string | null | undefined;
};

/** Followers who should hear about an event, given who caused it. */
export function recipientsFor(args: RecipientArgs): string[] {
  let ids = uniq(args.followerIds ?? []).filter((id) => id !== args.actorId);
  if (args.visibility === "private") {
    ids = ids.filter((id) => id === args.ownerId);
  }
  return ids;
}

/**
 * Fan-out for a new comment. Mentioned people get a `mention` row; every
 * other follower gets a `comment` row. A mentioned follower gets only the
 * mention — one event, one row per person.
 */
export function commentRecipients(
  args: RecipientArgs & { mentionedIds: readonly string[] },
): { mention: string[]; comment: string[] } {
  const mention = recipientsFor({ ...args, followerIds: args.mentionedIds });
  const mentionSet = new Set(mention);
  const comment = recipientsFor(args).filter((id) => !mentionSet.has(id));
  return { mention, comment };
}

// ---------------------------------------------------------------------------
// What the row says
// ---------------------------------------------------------------------------

export type TodoFieldsForDiff = {
  title: string;
  owner_id: string | null;
  due_date: string | null;
};

/**
 * One-line summary of what an edit changed — "Due Sep 20 · Owner Steph
 * Benes" — or null when nothing followers care about moved (description
 * tweaks, visibility, weekly focus). Null means no `updated` row is written.
 */
export function summarizeTodoChanges(
  before: TodoFieldsForDiff,
  after: TodoFieldsForDiff,
  nameOf: (uid: string) => string | null | undefined,
  formatDue: (iso: string) => string,
): string | null {
  const parts: string[] = [];
  if (before.title.trim() !== after.title.trim()) {
    parts.push(`Renamed to “${after.title.trim()}”`);
  }
  if ((before.owner_id ?? null) !== (after.owner_id ?? null)) {
    const name = after.owner_id ? nameOf(after.owner_id) : null;
    parts.push(`Owner ${name?.trim() || (after.owner_id ? "—" : "No Owner")}`);
  }
  if ((before.due_date ?? null) !== (after.due_date ?? null)) {
    parts.push(after.due_date ? `Due ${formatDue(after.due_date)}` : "Due date cleared");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Comment bodies are stored whole; the row carries a short preview. */
export function snippetOf(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The sentence the hub shows, minus the actor's name (rendered bold). */
export function notificationVerb(n: {
  kind: NotificationKind;
  entity_title: string;
}): string {
  const title = `“${n.entity_title}”`;
  switch (n.kind) {
    case "comment":
      return `commented on ${title}`;
    case "mention":
      return `mentioned you on ${title}`;
    case "completed":
      return `completed ${title}`;
    case "reopened":
      return `reopened ${title}`;
    case "updated":
      return `updated ${title}`;
    case "assigned":
      return `assigned you ${title}`;
    case "following":
      return `added you as a follower on ${title}`;
  }
}

/**
 * Which hub column a row lands in. Mentions are addressed to *you* by name,
 * so they get their own column; everything else is ambient activity on
 * to-dos you own or follow.
 */
export type NotificationColumn = "activity" | "mentions";

export function notificationColumn(n: {
  kind: NotificationKind;
}): NotificationColumn {
  return n.kind === "mention" ? "mentions" : "activity";
}

/** Where a row takes you. `?todo=` opens that row on the To-Dos tab. */
export function notificationHref(n: {
  team_id: string;
  entity_type: NotificationEntityType;
  entity_id: string;
}): string {
  switch (n.entity_type) {
    case "todo":
      return `/teams/${n.team_id}/todos?todo=${encodeURIComponent(n.entity_id)}`;
  }
}
