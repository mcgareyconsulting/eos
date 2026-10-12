// Metric follow rules that need no Firestore (docs/PERMISSIONS_SPEC.md §3.4,
// §5.3). The server actions in scorecard/actions.ts and lib/firebase/follow.ts
// call these; the tests pin them.
//
// Pure: no Firestore, no React.

import { metricAccess, type MetricSubject } from "@/lib/access/metric";
import type { Viewer } from "@/lib/access/types";
import {
  effectiveFollowers,
  isFollowing,
  isLockedFollower,
  lockedFollowers,
  storedFollowerIds,
} from "@/lib/follow";
import type { MetricEvent } from "@/lib/item-registry";

type Doc = Readonly<Record<string, unknown>>;

/**
 * Who must stop following after a metric's scorecard footprint shrinks
 * (a team untracks it, or it turns private). `after` is the metric as it
 * will be stored. A stored follower stays only while they can still follow
 * it (admin, or it is on a scorecard of one of their teams); the owner and
 * the current assigner are locked and never pruned. A follower with no
 * viewer record (deleted user) is pruned.
 */
export function followersToPrune(
  after: MetricSubject & Doc,
  viewers: ReadonlyMap<string, Viewer>,
): string[] {
  const locked = new Set(lockedFollowers("metric", after));
  return storedFollowerIds(after).filter((uid) => {
    if (locked.has(uid)) return false;
    const v = viewers.get(uid);
    return !v || !metricAccess.canFollow(after, v);
  });
}

/** `follower_ids` with the pruned people removed. */
export function prunedFollowerIds(
  after: MetricSubject & Doc,
  viewers: ReadonlyMap<string, Viewer>,
): string[] {
  const drop = new Set(followersToPrune(after, viewers));
  return storedFollowerIds(after).filter((id) => !drop.has(id));
}

/**
 * Follower events a metric edit produced (spec §5.3: "A change to the goal or
 * the owner"). A goal edit counts when the target or its direction moved.
 */
export function metricEditEvents(
  before: Doc,
  after: { goal: number | null; direction: string; owner_id: string | null },
): MetricEvent[] {
  const events: MetricEvent[] = [];
  const goal = typeof before.goal === "number" ? before.goal : null;
  const direction = typeof before.direction === "string" ? before.direction : "gte";
  if (goal !== after.goal || direction !== after.direction) {
    events.push("goal_changed");
  }
  const owner = typeof before.owner_id === "string" && before.owner_id ? before.owner_id : null;
  if (owner !== (after.owner_id || null)) events.push("owner_changed");
  return events;
}

/** A posted value is an event only when it is a number that differs from the stored one. */
export function isNewValue(prev: unknown, next: number | null): boolean {
  if (next === null) return false;
  return prev !== next;
}

/** What a row's Follow control shows for `uid` (owner and assigner are locked). */
export function metricFollowState(
  doc: Doc,
  uid: string,
): { following: boolean; locked: boolean; count: number } {
  return {
    following: isFollowing("metric", doc, uid),
    locked: isLockedFollower("metric", doc, uid),
    count: effectiveFollowers("metric", doc).length,
  };
}
