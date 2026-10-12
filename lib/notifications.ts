// In-app notifications — the pure half (docs/PERMISSIONS_SPEC.md §5.3).
//
// One system for every item type, keyed by `ItemRef = {type, id}` from
// lib/item-registry.ts. An *event* on an item fans out one `notifications`
// row per recipient: its followers (lib/follow.ts — stored `follower_ids`
// plus the locked owner and assigner) and anyone the event names directly
// (mentioned, assigned, unassigned, added to an audience…). Before a row is
// written the recipient's access is checked (`accessFor(type).canSee`), and
// the row is a POINTER only — kind, event, item, actor, time. Nothing about
// the item (title, comment text, team name) is copied into it: the hub
// resolves those at read time through the same access check, so a row for
// an item you can no longer see shows "You do not have access to this item."
//
// Firestore writes live in lib/firebase/notifications.ts. This file is the
// part worth unit-testing: who gets told, and what the row says.

import {
  linkFor,
  type ItemEvent,
  type ItemType,
} from "@/lib/item-registry";

/**
 * `entity_type` on a row. Every item type; legacy rows only ever say
 * `"todo"` (milestones included — a milestone is a `todos` doc).
 */
export type NotificationEntityType = ItemType;

/** Kinds addressed to one person by name, not to the followers. */
export type DirectKind =
  /** Someone @mentioned you in a comment. */
  | "mention"
  /** You were made the owner / assignee. */
  | "assigned"
  /** Your assignment was removed (spec §5.3). SPEC P8b/P10 produce it. */
  | "unassigned"
  /** You or your team were added to a rock's audience. SPEC P6b. */
  | "audience_added"
  /** A metric your team uses became private (to its leaders). SPEC P7b. */
  | "metric_private"
  /** Someone added you as a follower. */
  | "following";

export type NotificationKind =
  | DirectKind
  /** A comment on an item you follow. */
  | "comment"
  /** An item you follow was completed / solved / discussed. */
  | "completed"
  /** …and opened again. */
  | "reopened"
  /** Any other change on an item you follow — `event` says which. */
  | "updated";

/** Stored shape of a `/notifications/{id}` row: a pointer, nothing more. */
export type NotificationDoc = {
  /** Recipient. Rules key reads on this. */
  user_id: string;
  /** The item's parent team — where its link goes. */
  team_id: string;
  entity_type: NotificationEntityType;
  entity_id: string;
  kind: NotificationKind;
  /** The follower event behind a follower row; null for a direct kind. */
  event: ItemEvent | null;
  actor_id: string;
  created_at: unknown;
  read_at: unknown;
  /** Set by the hub's ✕ / "Archive read"; absent on rows older than the tab. */
  archived_at: unknown;
};

/**
 * Fields rows written before P5 also carry (copies of item data). Readers
 * ignore them — every label is resolved at read time through `canSee`.
 */
export type LegacyNotificationFields = {
  team_name?: string;
  entity_title?: string;
  actor_name?: string;
  detail?: string | null;
};

/** What the hub and peek show in place of an item the viewer cannot see. */
export const NO_ACCESS_TEXT = "You do not have access to this item.";

// ---------------------------------------------------------------------------
// Who gets told
// ---------------------------------------------------------------------------

function uniq(ids: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id === "string" && id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * When one person qualifies more than once, the first kind here wins — one
 * event, one row per person. A follower row is the fallback below them all.
 */
export const DIRECT_PRECEDENCE: readonly DirectKind[] = [
  "mention",
  "assigned",
  "unassigned",
  "audience_added",
  "metric_private",
  "following",
];

/**
 * Kinds that tell a person they LOST something, so by definition they may
 * no longer see the item. The send-time access check does not drop these;
 * the row is a pointer only, and opening it shows NO_ACCESS_TEXT.
 */
export const ACCESS_EXEMPT_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  "unassigned",
  "metric_private",
]);

/** The row kind a follower event lands as (the hub's icon and column). */
export function kindForEvent(event: ItemEvent): NotificationKind {
  switch (event) {
    case "comment":
      return "comment";
    case "completed":
    case "solved":
    case "discussed":
    case "milestone_completed":
      return "completed";
    case "reopened":
      return "reopened";
    default:
      return "updated";
  }
}

export type Delivery = { uid: string; kind: NotificationKind };

/**
 * Recipients of one event, before the access check: everyone named under
 * `direct` gets that kind (highest precedence wins); every other follower
 * gets the follower event's kind, when there is an event. The actor never
 * hears about their own action.
 */
export function planRecipients(args: {
  followers: readonly (string | null | undefined)[];
  event: ItemEvent | null;
  actorId: string;
  direct?: Partial<Record<DirectKind, readonly (string | null | undefined)[]>>;
}): Delivery[] {
  const out: Delivery[] = [];
  const seen = new Set<string>([args.actorId]);
  for (const kind of DIRECT_PRECEDENCE) {
    for (const uid of uniq(args.direct?.[kind] ?? [])) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      out.push({ uid, kind });
    }
  }
  if (args.event) {
    const kind = kindForEvent(args.event);
    for (const uid of uniq(args.followers)) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      out.push({ uid, kind });
    }
  }
  return out;
}

/**
 * The spec's send-time check: drop every delivery whose recipient cannot see
 * the item, except the "you lost it" kinds (ACCESS_EXEMPT_KINDS).
 */
export function filterByAccess(
  plan: readonly Delivery[],
  canSee: (uid: string) => boolean,
): Delivery[] {
  return plan.filter((d) => ACCESS_EXEMPT_KINDS.has(d.kind) || canSee(d.uid));
}

// ---------------------------------------------------------------------------
// To-do follower helpers (the Add / Edit forms' follower pickers)
// ---------------------------------------------------------------------------

/**
 * Followers a brand-new to-do starts with: whoever created it (the
 * assigner), whoever it was assigned to, and anyone the creator picked
 * under "Add followers". No doubles.
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
 * Followers after the Edit form's picker is saved. The locked followers
 * (owner + current assigner, lib/follow.ts) always stay; everyone else is
 * exactly who was left checked. A private to-do drops the picks. Returns
 * who was added and removed so the caller can notify and record both.
 */
export function applyFollowerEdit(args: {
  current: readonly string[] | null | undefined;
  ownerId: string | null | undefined;
  /** Owner + assigner; defaults to just the owner. */
  lockedIds?: readonly (string | null | undefined)[];
  picked: readonly string[];
  visibility: "team" | "private" | string | null | undefined;
}): { next: string[]; added: string[]; removed: string[] } {
  const before = uniq(args.current ?? []);
  const locked = uniq([args.ownerId, ...(args.lockedIds ?? [])]);
  const next =
    args.visibility === "private"
      ? locked
      : uniq([...locked, ...args.picked]);
  return {
    next,
    added: next.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !next.includes(id)),
  };
}

// ---------------------------------------------------------------------------
// What the row says
// ---------------------------------------------------------------------------

export type TodoFieldsForDiff = {
  title: string;
  owner_id: string | null;
  due_date: string | null;
  description?: string | null;
};

/**
 * The follower events a to-do edit fired, most significant first (spec §5.3
 * "Events for followers": title, due date, description, reassigned).
 */
export function todoEditEvents(
  before: TodoFieldsForDiff,
  after: TodoFieldsForDiff,
): ("reassigned" | "title_changed" | "due_date_changed" | "description_changed")[] {
  const out: (
    | "reassigned"
    | "title_changed"
    | "due_date_changed"
    | "description_changed"
  )[] = [];
  if ((before.owner_id ?? null) !== (after.owner_id ?? null)) out.push("reassigned");
  if (before.title.trim() !== after.title.trim()) out.push("title_changed");
  if ((before.due_date ?? null) !== (after.due_date ?? null)) out.push("due_date_changed");
  if ((before.description ?? null) !== (after.description ?? null)) {
    out.push("description_changed");
  }
  return out;
}

/**
 * One-line summary of what an edit changed — "Due Sep 20 · Owner Steph
 * Benes" — or null when nothing followers care about moved. Used for the
 * activity trace (team-gated, unlike a notification row).
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

/** Comment bodies are stored whole; previews are cut short. */
export function snippetOf(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

const NOUN: Record<ItemType, string> = {
  rock: "a rock",
  milestone: "a milestone",
  todo: "a to-do",
  issue: "an issue",
  metric: "a metric",
  headline: "a headline",
};

/** "a to-do", "an issue" — what a row names when it has no title to show. */
export function itemNoun(type: string): string {
  return NOUN[type as ItemType] ?? "an item";
}

const EVENT_VERB: Record<ItemEvent, string> = {
  comment: "commented on",
  completed: "completed",
  reopened: "reopened",
  title_changed: "renamed",
  due_date_changed: "changed the due date of",
  description_changed: "edited the description of",
  reassigned: "reassigned",
  status_changed: "changed the status of",
  milestone_completed: "completed a milestone on",
  owner_changed: "changed the owner of",
  solved: "solved",
  archived: "archived",
  value_posted: "posted a new value on",
  goal_changed: "changed the goal of",
  text_changed: "edited",
  discussed: "marked discussed",
};

const KIND_VERB: Record<NotificationKind, string> = {
  mention: "mentioned you on",
  assigned: "assigned you",
  unassigned: "removed your assignment on",
  audience_added: "shared with you",
  metric_private: "made private",
  following: "added you as a follower on",
  comment: "commented on",
  completed: "completed",
  reopened: "reopened",
  updated: "updated",
};

/**
 * The sentence the hub shows, minus the actor's name (rendered bold).
 * `title` comes from the read-time peek; without one (still loading, or no
 * access) the row names the item's type instead.
 */
export function notificationVerb(
  n: {
    kind: NotificationKind;
    event?: ItemEvent | null;
    entity_type: string;
  },
  title?: string | null,
): string {
  const verb =
    !DIRECT_PRECEDENCE.includes(n.kind as DirectKind) && n.event
      ? (EVENT_VERB[n.event] ?? KIND_VERB[n.kind])
      : (KIND_VERB[n.kind] ?? "updated");
  const object = title?.trim() ? `“${title.trim()}”` : itemNoun(n.entity_type);
  return `${verb} ${object}`;
}

/**
 * Which hub column a row lands in. Mentions are addressed to *you* by name,
 * so they get their own column; everything else is ambient activity on
 * items you own or follow.
 */
export type NotificationColumn = "activity" | "mentions";

export function notificationColumn(n: {
  kind: NotificationKind;
}): NotificationColumn {
  return n.kind === "mention" ? "mentions" : "activity";
}

/** Where a row takes you — the registry's link for its item. */
export function notificationHref(n: {
  team_id: string;
  entity_type: NotificationEntityType;
  entity_id: string;
}): string {
  return linkFor({ type: n.entity_type, id: n.entity_id }, n.team_id);
}

/** Title + snippet of an item doc, for the read-time peek. */
export function itemLabel(
  type: ItemType,
  data: Readonly<Record<string, unknown>>,
): { title: string; snippet: string | null } {
  const rawTitle = type === "metric" ? data.name : data.title;
  const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : "";
  const rawBody = type === "headline" ? data.body : data.description;
  const snippet =
    typeof rawBody === "string" && rawBody.trim() ? snippetOf(rawBody) : null;
  return { title, snippet };
}
