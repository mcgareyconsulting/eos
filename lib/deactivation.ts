// Deactivation cascade planning (docs/PERMISSIONS_SPEC.md §2.6, build graph
// P10 / D5). Pure: no Firestore. lib/firebase/deactivate.ts does the I/O.
//
// Deactivating a person DISABLES the account (reversible) and leaves every
// item they owned unassigned. A headline's owner is its creator, so it is
// flagged `owner_unassigned: true` instead of rewriting `created_by`.

import type { ItemCollection, ItemRef, ItemType } from "@/lib/item-registry";

/** Firestore's batch limit is 500 writes; stay at it, never above. */
export const BATCH_LIMIT = 500;

export function chunk<T>(items: readonly T[], size = BATCH_LIMIT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Collections whose items have an owner to unassign (feedback items have none). */
export type OwnedCollection = Exclude<ItemCollection, "feedback_items">;

/** The owned docs, as read from each collection. */
export type OwnedDoc = {
  collection: OwnedCollection;
  id: string;
  data: Record<string, unknown>;
};

export type UnassignPatch = {
  collection: OwnedCollection;
  id: string;
  patch: Record<string, null | boolean>;
};

export type NotifyGroup = {
  teamId: string;
  /** One representative item the notification points at. */
  ref: ItemRef;
  /** How many items of this team were unassigned (private to-dos excluded). */
  count: number;
};

export type UnassignPlan = {
  patches: UnassignPatch[];
  notify: NotifyGroup[];
};

/** Which registry type a stored doc is. */
export function itemTypeOf(doc: OwnedDoc): ItemType {
  switch (doc.collection) {
    case "rocks":
      return "rock";
    case "issues":
      return "issue";
    case "scorecard_metrics":
      return "metric";
    case "headlines":
      return "headline";
    case "todos":
      return typeof doc.data.source_rock_id === "string" && doc.data.source_rock_id
        ? "milestone"
        : "todo";
  }
}

function isPrivateTodo(doc: OwnedDoc): boolean {
  return doc.collection === "todos" && doc.data.visibility === "private";
}

/** Representative preference when a team has several unassigned items. */
const REP_ORDER: readonly ItemType[] = [
  "rock",
  "milestone",
  "todo",
  "issue",
  "metric",
  "headline",
];

export function planUnassign(docs: readonly OwnedDoc[]): UnassignPlan {
  const patches: UnassignPatch[] = [];
  const byTeam = new Map<string, { ref: ItemRef; rank: number; count: number }>();

  for (const doc of docs) {
    patches.push({
      collection: doc.collection,
      id: doc.id,
      patch:
        doc.collection === "headlines" ? { owner_unassigned: true } : { owner_id: null },
    });

    // Private to-dos: leaders cannot see them, so they hear nothing.
    if (isPrivateTodo(doc)) continue;
    const teamId = typeof doc.data.team_id === "string" ? doc.data.team_id : "";
    if (!teamId) continue;
    const type = itemTypeOf(doc);
    const rank = REP_ORDER.indexOf(type);
    const cur = byTeam.get(teamId);
    if (!cur) {
      byTeam.set(teamId, { ref: { type, id: doc.id }, rank, count: 1 });
    } else {
      cur.count++;
      if (rank < cur.rank) {
        cur.ref = { type, id: doc.id };
        cur.rank = rank;
      }
    }
  }

  const notify = [...byTeam.entries()].map(([teamId, v]) => ({
    teamId,
    ref: v.ref,
    count: v.count,
  }));
  return { patches, notify };
}

export type DeactivateGuard = { ok: true } | { ok: false; error: string };

export const SELF_DEACTIVATE_MESSAGE =
  "You can't deactivate your own account — you would lose admin access with it.";

/** Pure guards; `hasOtherAdmin` only matters for an admin target. */
export function checkDeactivate(args: {
  uid: string;
  actorUid: string;
  targetIsAdmin: boolean;
  hasOtherAdmin: boolean;
  lastAdminMessage: string;
}): DeactivateGuard {
  if (!args.uid) return { ok: false, error: "No user given" };
  if (args.uid === args.actorUid) return { ok: false, error: SELF_DEACTIVATE_MESSAGE };
  if (args.targetIsAdmin && !args.hasOtherAdmin) {
    return { ok: false, error: args.lastAdminMessage };
  }
  return { ok: true };
}

/** What a null owner renders as (spec §2.6). */
export const UNASSIGNED_LABEL = "Unassigned";

/**
 * Owner-required rule (spec §2.6): a save needs an owner, except issues, and
 * except an existing item whose save does not touch the owner field (a
 * stored null stays). `nextOwner` is undefined when the save leaves it alone.
 */
export function ownerRequiredError(args: {
  type: ItemType;
  nextOwner: string | null | undefined;
  isNew: boolean;
}): string | null {
  if (args.type === "issue") return null;
  if (args.nextOwner === undefined) return args.isNew ? "Choose an owner." : null;
  return args.nextOwner ? null : "Choose an owner.";
}
