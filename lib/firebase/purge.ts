// `purgeItem` — what deleting an item takes with it (docs/PERMISSIONS_SPEC.md
// §5.1: "When a person deletes an item, the application deletes its thread
// and its notifications"), plus its activity trace. Admin SDK; server only.
//
// Call it after the item doc itself is deleted. Equality filters only, so
// no composite index is needed; `entity_type` is checked in code.

import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { stampBeforeDelete } from "@/lib/audit-stamp";
import { registryFor, type ItemRef, type ItemType } from "@/lib/item-registry";

/**
 * `entity_type` values a row about `type` may carry. To-dos and milestones
 * share the `todos` collection, and pre-P5 rows call both "todo".
 */
function rowTypes(type: ItemType): ReadonlySet<string> {
  return type === "todo" || type === "milestone"
    ? new Set(["todo", "milestone"])
    : new Set([type]);
}

async function rowsFor(
  db: Firestore,
  collection: string,
  id: string,
  types: ReadonlySet<string>,
): Promise<QueryDocumentSnapshot[]> {
  const snap = await db.collection(collection).where("entity_id", "==", id).get();
  return snap.docs.filter((d) => types.has(String(d.data()?.entity_type ?? "")));
}

/** Deletes the item's comments, notifications and activity rows. Returns counts. */
export async function purgeItem(
  db: Firestore,
  ref: ItemRef,
  /** Who deleted the item; attributes the comment and activity deletes (C-07). */
  actorUid?: string | null,
): Promise<{ comments: number; notifications: number; activity: number }> {
  const thread = registryFor(ref.type).threadEntityType;
  const [comments, notifications, activity] = await Promise.all([
    thread
      ? rowsFor(db, "entity_comments", ref.id, new Set([thread]))
      : Promise.resolve([]),
    rowsFor(db, "notifications", ref.id, rowTypes(ref.type)),
    rowsFor(db, "entity_activity", ref.id, rowTypes(ref.type)),
  ]);
  // Notifications are not audited, so they are not stamped.
  if (actorUid) {
    await stampBeforeDelete(
      [...comments, ...activity].map((d) => d.ref),
      actorUid,
    );
  }
  const all = [...comments, ...notifications, ...activity];
  for (let i = 0; i < all.length; i += 400) {
    const batch = db.batch();
    for (const d of all.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  return {
    comments: comments.length,
    notifications: notifications.length,
    activity: activity.length,
  };
}
