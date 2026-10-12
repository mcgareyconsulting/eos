// Follow writes (Admin SDK; server only) — the generic half of lib/follow.ts.
// Gated by `accessFor(type).canFollow` (docs/PERMISSIONS_SPEC.md §5.3).

import type { Firestore } from "firebase-admin/firestore";
import type { Viewer } from "@/lib/access";
import { registryFor, type ItemRef } from "@/lib/item-registry";
import { applyFollow, withAutoFollowers } from "@/lib/follow";
import {
  canFollowItem,
  canSeeItem,
  loadItem,
  loadViewers,
  type LoadedItem,
  type ViewerDeps,
} from "./items";

export type FollowResult =
  | { ok: true; item: LoadedItem; changed: boolean }
  | { ok: false; reason: "not_found" | "forbidden" | "locked" };

/**
 * Follow or unfollow `ref` as `viewer`. Not visible → not_found (no
 * existence leak); visible but not followable → forbidden; a locked
 * follower (owner / current assigner) unfollowing → locked.
 */
export async function setFollowingAs(
  db: Firestore,
  ref: ItemRef,
  viewer: Viewer,
  follow: boolean,
): Promise<FollowResult> {
  const item = await loadItem(db, ref);
  if (!item || !canSeeItem(item, viewer)) return { ok: false, reason: "not_found" };
  if (!canFollowItem(item, viewer)) return { ok: false, reason: "forbidden" };
  const change = applyFollow(item.ref.type, item.data, viewer.uid, follow);
  if (!change.ok) return { ok: false, reason: change.reason };
  if (change.changed) {
    await db
      .collection(registryFor(item.ref.type).collection)
      .doc(item.ref.id)
      .update({ follower_ids: change.follower_ids });
  }
  return { ok: true, item, changed: change.changed };
}

/**
 * Auto-follow (spec §5.3): the comment's author and the people it mentions
 * start following. Anyone who may not follow the item is skipped — a
 * mention never grants access. Returns who was added. Never throws.
 */
export async function autoFollow(
  db: Firestore,
  ref: ItemRef,
  uids: readonly (string | null | undefined)[],
  deps: ViewerDeps = {},
): Promise<string[]> {
  try {
    const item = await loadItem(db, ref);
    if (!item) return [];
    const { added } = withAutoFollowers(item.data, uids);
    if (added.length === 0) return [];
    const viewers = await loadViewers(db, added, deps);
    const allowed = added.filter((uid) => {
      const v = viewers.get(uid);
      return !!v && canFollowItem(item, v);
    });
    if (allowed.length === 0) return [];
    const { follower_ids } = withAutoFollowers(item.data, allowed);
    await db
      .collection(registryFor(item.ref.type).collection)
      .doc(item.ref.id)
      .update({ follower_ids });
    return allowed;
  } catch (e) {
    console.error(`[follow] auto-follow on ${ref.type}/${ref.id} failed:`, e);
    return [];
  }
}
