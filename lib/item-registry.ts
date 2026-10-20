// The item registry (docs/PERMISSIONS_SPEC.md §5.0, §6).
//
// Each item type gives five values — shape, owner, assigner, events, link —
// plus where it is stored. The thread, mention, follow and notification
// functions (P5, P9) read only this registry and `accessFor` in
// lib/access; they never branch on a type. To add an item type, add an
// entry here and an access module, nothing else.
//
// Pure: no Firestore, no React. Values describe what is stored TODAY; where
// the spec needs a field that does not exist yet the entry says so with a
// `// SPEC Pn:` marker.

import type { AccessShape, ItemType } from "@/lib/access/types";

export type { ItemType } from "@/lib/access/types";

/** A pointer to one item — what notifications and follows will store (P5). */
export type ItemRef = { type: ItemType; id: string };

// ---------------------------------------------------------------------------
// Events for followers (spec §5.3, "Events for followers")
// ---------------------------------------------------------------------------

/** To-do and milestone: a comment; completed or opened again; title / due date / description changed; reassigned. */
export type TodoEvent =
  | "comment"
  | "completed"
  | "reopened"
  | "title_changed"
  | "due_date_changed"
  | "description_changed"
  | "reassigned";

/** Rock: a comment; a status change; a milestone completed; owner or due date changed. */
export type RockEvent =
  | "comment"
  | "status_changed"
  | "milestone_completed"
  | "owner_changed"
  | "due_date_changed";

/** Issue: a comment; solved or archived; owner changed. */
export type IssueEvent = "comment" | "solved" | "archived" | "owner_changed";

/** Metric: a new value posted; goal or owner changed. */
export type MetricEvent = "value_posted" | "goal_changed" | "owner_changed";

/** Headline: a comment; text changed; discussed or archived. */
export type HeadlineEvent = "comment" | "text_changed" | "discussed" | "archived";

/** Feedback tracker item (N73): a comment. Status and edits stay in its own activity log. */
export type FeedbackEvent = "comment";

export type ItemEventFor = {
  rock: RockEvent;
  milestone: TodoEvent;
  todo: TodoEvent;
  issue: IssueEvent;
  metric: MetricEvent;
  headline: HeadlineEvent;
  feedback: FeedbackEvent;
};

export type ItemEvent = ItemEventFor[ItemType];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type ItemCollection =
  | "rocks"
  | "todos"
  | "issues"
  | "scorecard_metrics"
  | "headlines"
  | "feedback_items";

/** `entity_comments.entity_type` values (CommentEntityType in entity-comments/actions.ts). */
export type ThreadEntityType = "issue" | "rock" | "todo" | "headline" | "feedback";

export type ItemRegistryEntry<T extends ItemType = ItemType> = {
  type: T;
  /**
   * The access shape(s) (spec §3). A to-do is A or B by `visibility`;
   * `accessFor(type)` (lib/access) resolves which per document.
   */
  shapes: readonly AccessShape[];
  /** Firestore collection. A milestone is a `todos` doc with `source_rock_id`. */
  collection: ItemCollection;
  /**
   * The field naming the owner (spec §5.0 "Owner"), or null for a type with
   * no owner (a feedback item — so no locked follower either).
   */
  ownerField: "owner_id" | "created_by" | null;
  /** Spec §5.0 "Assigner": does this type have one? */
  hasAssigner: boolean;
  /**
   * The stored field naming who made the current assignment (spec §5.3
   * locked follower), or null for a type without an assigner. Legacy docs
   * lack it; lib/follow.ts `assignerOf` falls back to `created_by` (§8).
   */
  assignerField: "assigned_by" | null;
  /** The thread this item's comments live in today, or null for none. */
  threadEntityType: ThreadEntityType | null;
  /** What followers are notified about (spec §5.3). */
  events: readonly ItemEventFor[T][];
  /**
   * Who the comment box's @ picker lists. "everyone": the whole Directory,
   * the people who cannot see the item greyed (spec §5.2). "audience": only
   * the people who can see it — for an item whose audience is itself
   * restricted (the feedback tracker's access list), where the greyed rest
   * of the org is noise. Either way the server resolves a typed name
   * against everyone and refuses a mention of someone who cannot see it.
   */
  mentionPicker: "everyone" | "audience";
  /** Where a notification or mention about this item takes you. */
  link: (teamId: string, id: string) => string;
};

const TODO_EVENTS: readonly TodoEvent[] = [
  "comment",
  "completed",
  "reopened",
  "title_changed",
  "due_date_changed",
  "description_changed",
  "reassigned",
];

/** The feedback tracker's deep link (app/(app)/admin/feedback/page.tsx `?item=`). */
function feedbackPath(id: string): string {
  return `/admin/feedback?item=${encodeURIComponent(id)}`;
}

function teamPath(teamId: string, page: string, param: string, id: string): string {
  // The team id is a Firestore doc id, used raw; the item id is encoded.
  return `/teams/${teamId}/${page}?${param}=${encodeURIComponent(id)}`;
}

// Deep links. The To-Dos page reads `?todo=`, the Rocks page `?rock=` /
// `?milestone=`, the Issues page `?issue=` and the Headlines page
// `?headline=` (P9). `?metric=` on the Scorecard is still ignored (P7).

export const ITEM_REGISTRY: { readonly [K in ItemType]: ItemRegistryEntry<K> } = {
  rock: {
    type: "rock",
    shapes: ["rock"],
    collection: "rocks",
    ownerField: "owner_id",
    hasAssigner: true,
    // Written on every owner change (lib/follow.ts assignmentPatch).
    // SPEC P6: the rock actions start writing it (rocks/** is P6's).
    assignerField: "assigned_by",
    threadEntityType: "rock",
    events: [
      "comment",
      "status_changed",
      "milestone_completed",
      "owner_changed",
      "due_date_changed",
    ],
    mentionPicker: "everyone",
    link: (teamId, id) => teamPath(teamId, "rocks", "rock", id),
  },
  milestone: {
    type: "milestone",
    // Shape C, plus its own assignee (spec §5.0).
    shapes: ["rock"],
    collection: "todos",
    ownerField: "owner_id",
    hasAssigner: true,
    // Milestone owner changes run through the rock modal (SPEC P6 writes it).
    assignerField: "assigned_by",
    // A milestone is a to-do: it uses the to-do thread (spec change 2).
    threadEntityType: "todo",
    events: TODO_EVENTS,
    // "The milestone in its rock". The link builder only gets the
    // milestone's id; the Rocks page resolves its rock (P9).
    mentionPicker: "everyone",
    link: (teamId, id) => teamPath(teamId, "rocks", "milestone", id),
  },
  todo: {
    type: "todo",
    shapes: ["team-item", "private-item"],
    collection: "todos",
    ownerField: "owner_id",
    hasAssigner: true,
    // Written by addTodo / updateTodoMeta; legacy docs fall back to
    // `created_by` (the §8 migration seeds it from there).
    assignerField: "assigned_by",
    threadEntityType: "todo",
    events: TODO_EVENTS,
    mentionPicker: "everyone",
    link: (teamId, id) => teamPath(teamId, "todos", "todo", id),
  },
  issue: {
    type: "issue",
    shapes: ["team-item"],
    collection: "issues",
    ownerField: "owner_id",
    hasAssigner: true,
    // Written by addIssue / updateIssueMeta (lib/follow.ts assignmentPatch).
    assignerField: "assigned_by",
    threadEntityType: "issue",
    events: ["comment", "solved", "archived", "owner_changed"],
    mentionPicker: "everyone",
    link: (teamId, id) => teamPath(teamId, "issues", "issue", id),
  },
  metric: {
    type: "metric",
    shapes: ["metric"],
    collection: "scorecard_metrics",
    ownerField: "owner_id",
    hasAssigner: true,
    // SPEC P7: metric owner changes write it (scorecard/** is P7's).
    assignerField: "assigned_by",
    // A metric has no thread (spec §5.1).
    threadEntityType: null,
    events: ["value_posted", "goal_changed", "owner_changed"],
    mentionPicker: "everyone",
    link: (teamId, id) => teamPath(teamId, "scorecard", "metric", id),
  },
  headline: {
    type: "headline",
    shapes: ["team-item"],
    collection: "headlines",
    // A headline's owner is its creator (spec §5.0).
    ownerField: "created_by",
    // A headline has no assignee, so no assigner (spec §5.0).
    hasAssigner: false,
    assignerField: null,
    // Headlines have a thread (spec §5.1), `entity_type: "headline"`.
    threadEntityType: "headline",
    events: ["comment", "text_changed", "discussed", "archived"],
    mentionPicker: "everyone",
    link: (teamId, id) => teamPath(teamId, "headlines", "headline", id),
  },
  feedback: {
    type: "feedback",
    // Not a team shape: the tracker's access list (lib/access/feedback.ts).
    shapes: [],
    collection: "feedback_items",
    ownerField: null,
    hasAssigner: false,
    assignerField: null,
    // Comments live in `entity_comments` like every thread, but no client
    // reads them (firestore.rules): the modal loads them from the server.
    threadEntityType: "feedback",
    // Mentioned people hear about a comment; nobody follows (canFollow is
    // false), so there is no follower fan-out.
    events: ["comment"],
    mentionPicker: "audience",
    // The tracker is one page, not a team's; `teamId` is ignored.
    link: (_teamId, id) => feedbackPath(id),
  },
};

export const ITEM_TYPES: readonly ItemType[] = [
  "rock",
  "milestone",
  "todo",
  "issue",
  "metric",
  "headline",
  "feedback",
];

export function registryFor<T extends ItemType>(type: T): ItemRegistryEntry<T> {
  return ITEM_REGISTRY[type] as ItemRegistryEntry<T>;
}

export function isItemType(value: unknown): value is ItemType {
  return typeof value === "string" && (ITEM_TYPES as readonly string[]).includes(value);
}

/** A `todos` doc is a milestone when it hangs off a rock. */
export function itemTypeOfTodoDoc(doc: {
  source_rock_id?: string | null;
}): "todo" | "milestone" {
  return typeof doc.source_rock_id === "string" && doc.source_rock_id !== ""
    ? "milestone"
    : "todo";
}

/** The owner uid stored on a document, read through the registry's owner field. */
export function ownerOf(
  type: ItemType,
  doc: Readonly<Record<string, unknown>>,
): string | null {
  const field = registryFor(type).ownerField;
  if (!field) return null;
  const v = doc[field];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Spec §5.3: may followers be told about `event` on an item of `type`? */
export function isEventFor<T extends ItemType>(
  type: T,
  event: string,
): event is ItemEventFor[T] {
  return (registryFor(type).events as readonly string[]).includes(event);
}

/** `ItemRef` → link, for a ref whose parent team is known. */
export function linkFor(ref: ItemRef, teamId: string): string {
  return registryFor(ref.type).link(teamId, ref.id);
}
