// The follow relation — one model for every item type (docs/PERMISSIONS_SPEC.md
// §5.0, §5.3 "Follow" and "Followers who cannot stop following").
//
// Stored shape, on every followable item doc:
//   follower_ids: string[]   — who opted in (or was auto-followed)
//   assigned_by:  string     — who made the current assignment (types whose
//                              registry entry has `hasAssigner`)
//
// The owner (registry `ownerField`) and the current assigner are LOCKED
// followers: they follow whether or not they are in `follower_ids`, and the
// server refuses their unfollow. On a reassignment the new owner and the new
// assigner lock; the old owner and the old assigner are written into
// `follower_ids`, so they stay followers but can now stop.
//
// `assigned_by` is absent on legacy docs. The §8 migration seeds it from
// `created_by`; until then this module reads `created_by` in its place.
//
// Pure: no Firestore, no React — safe to import from client components.

import { ownerOf, registryFor, type ItemType } from "@/lib/item-registry";

type Doc = Readonly<Record<string, unknown>>;

function uniq(ids: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id === "string" && id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** `follower_ids` as stored, strings only. */
export function storedFollowerIds(doc: Doc): string[] {
  const v = doc.follower_ids;
  return Array.isArray(v)
    ? uniq(v.filter((x): x is string => typeof x === "string"))
    : [];
}

/**
 * The current assigner: `assigned_by`, else `created_by` for a legacy doc
 * (spec §8 migration seeds the one from the other). Null for a type without
 * an assigner (headline) or when neither is stored.
 */
export function assignerOf(type: ItemType, doc: Doc): string | null {
  if (!registryFor(type).hasAssigner) return null;
  for (const field of ["assigned_by", "created_by"] as const) {
    const v = doc[field];
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

/** Owner + current assigner — the followers who cannot stop following. */
export function lockedFollowers(type: ItemType, doc: Doc): string[] {
  return uniq([ownerOf(type, doc), assignerOf(type, doc)]);
}

/** For the UI: show Follow as fixed-on for this person. */
export function isLockedFollower(
  type: ItemType,
  doc: Doc,
  uid: string,
): boolean {
  return lockedFollowers(type, doc).includes(uid);
}

/** Everyone who follows: the locked followers plus the stored list. */
export function effectiveFollowers(type: ItemType, doc: Doc): string[] {
  return uniq([...lockedFollowers(type, doc), ...storedFollowerIds(doc)]);
}

/** Is `uid` following, counting the locked followers? */
export function isFollowing(type: ItemType, doc: Doc, uid: string): boolean {
  return effectiveFollowers(type, doc).includes(uid);
}

export type FollowChange =
  | { ok: true; follower_ids: string[]; changed: boolean }
  | { ok: false; reason: "locked" };

/**
 * The Follow / Unfollow toggle. Refuses an unfollow by a locked follower.
 * Access (`canFollow`) is the caller's check — this is only the list math.
 */
export function applyFollow(
  type: ItemType,
  doc: Doc,
  uid: string,
  follow: boolean,
): FollowChange {
  const current = storedFollowerIds(doc);
  if (follow) {
    if (current.includes(uid)) {
      return { ok: true, follower_ids: current, changed: false };
    }
    return { ok: true, follower_ids: [...current, uid], changed: true };
  }
  if (isLockedFollower(type, doc, uid)) return { ok: false, reason: "locked" };
  const next = current.filter((id) => id !== uid);
  return {
    ok: true,
    follower_ids: next,
    changed: next.length !== current.length,
  };
}

/** Auto-follow (spec §5.3: writing a comment, being mentioned). */
export function withAutoFollowers(
  doc: Doc,
  uids: readonly (string | null | undefined)[],
): { follower_ids: string[]; added: string[] } {
  const current = storedFollowerIds(doc);
  const added = uniq(uids).filter((id) => !current.includes(id));
  return { follower_ids: [...current, ...added], added };
}

/**
 * The fields an owner change writes. `assigned_by` becomes the actor; the
 * old owner and the old assigner are kept as plain (unlocked) followers; the
 * new owner and new assigner are stored too, so the list stays complete
 * once they hand off in turn. An unchanged owner returns the doc's values.
 */
export function assignmentPatch(
  type: ItemType,
  before: Doc,
  nextOwnerId: string | null,
  actorId: string,
): { assigned_by: string | null; follower_ids: string[]; reassigned: boolean } {
  const prevOwner = ownerOf(type, before);
  const prevAssigner = assignerOf(type, before);
  const hasAssigner = registryFor(type).hasAssigner;
  if ((nextOwnerId || null) === prevOwner) {
    return {
      assigned_by: prevAssigner,
      follower_ids: storedFollowerIds(before),
      reassigned: false,
    };
  }
  return {
    assigned_by: hasAssigner ? actorId : null,
    follower_ids: uniq([
      ...storedFollowerIds(before),
      prevOwner,
      prevAssigner,
      nextOwnerId,
      hasAssigner ? actorId : null,
    ]),
    reassigned: true,
  };
}
