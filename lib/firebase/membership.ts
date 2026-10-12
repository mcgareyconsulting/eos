// Denormalized team list on the profile: `users/{uid}.team_ids`.
//
// Why it exists (PERMISSIONS_BUILD_GRAPH D2 / P14): firestore.rules cannot
// loop, and every exists()/get() costs one of the 10 document lookups a
// request may make. Checking "is the caller on any team this doc was shared
// into" one `team_members` row at a time is what caps shared team lists at 8
// (`listSharedToMe`). With the caller's team ids on their own profile, a rule
// does ONE get() of users/{uid} and a `hasAny()` instead, however many teams
// the doc is shared into.
//
// `team_members` stays the source of truth. `team_ids` is a server-maintained
// cache of it: every server path that adds or removes a `team_members` row
// calls syncUserTeamIds() for each uid it touched, after its write commits,
// and `pnpm users:backfill-team-ids` rebuilds it from scratch. The client can
// never write it (rules must keep `team_ids` out of any client-writable
// field set on users/{uid}).
//
// It is a full recompute, never an arrayUnion/arrayRemove patch, so a missed
// or doubled call heals on the next one. A role change alone does not change
// the set, so role-only writes do not need to call it.

import { stamp } from "@/lib/audit-stamp";
import type { Firestore } from "firebase-admin/firestore";

export const TEAM_IDS_FIELD = "team_ids";

type Row = Record<string, unknown> | undefined;

/** Unique, sorted team ids from a user's `team_members` rows. */
export function computeTeamIds(memberships: Row[]): string[] {
  const ids = new Set<string>();
  for (const m of memberships) {
    const id = m?.team_id;
    if (typeof id === "string" && id.length > 0) ids.add(id);
  }
  return [...ids].sort();
}

/** What a profile currently carries, or null when the field is absent/garbled. */
export function currentTeamIds(profile: Row): string[] | null {
  const raw = profile?.[TEAM_IDS_FIELD];
  if (!Array.isArray(raw)) return null;
  return raw.filter((v): v is string => typeof v === "string");
}

export type TeamIdsPlan =
  /** Profile needs `team_ids` set to `after`. */
  | { kind: "write"; before: string[] | null; after: string[] }
  /** Already correct (canonical sorted form) — skip the write. */
  | { kind: "unchanged"; before: string[]; after: string[] }
  /**
   * No users/{uid} doc. Not written: a merge would resurrect a profile that
   * delete-team --prune-users just removed, or mint a nameless stub the
   * Directory would list. Fails closed — the rules' get() on a missing
   * profile denies.
   */
  | { kind: "no-profile"; after: string[] };

export function planTeamIdsSync(
  profile: Row,
  memberships: Row[],
): TeamIdsPlan {
  const after = computeTeamIds(memberships);
  if (profile === undefined) return { kind: "no-profile", after };
  const before = currentTeamIds(profile);
  // Exact match against the canonical (sorted, unique) form, so a profile
  // carrying the right set in a different order is normalized once.
  if (
    before !== null &&
    before.length === after.length &&
    before.every((id, i) => id === after[i])
  ) {
    return { kind: "unchanged", before, after };
  }
  return { kind: "write", before, after };
}

/**
 * Recompute users/{uid}.team_ids from `team_members where user_id == uid` and
 * merge it onto the profile. Call AFTER the roster write has committed.
 */
export async function syncUserTeamIds(
  db: Firestore,
  uid: string,
  /** The signed-in person behind the roster change, stamped for the audit log (C-07). */
  actorUid?: string | null,
): Promise<TeamIdsPlan> {
  const [memberships, profile] = await Promise.all([
    db.collection("team_members").where("user_id", "==", uid).get(),
    db.collection("users").doc(uid).get(),
  ]);
  const plan = planTeamIdsSync(
    profile.exists ? (profile.data() ?? {}) : undefined,
    memberships.docs.map((d) => d.data()),
  );
  if (plan.kind === "write") {
    await db
      .collection("users")
      .doc(uid)
      .set(
        { [TEAM_IDS_FIELD]: plan.after, ...(actorUid ? stamp(actorUid) : {}) },
        { merge: true },
      );
  }
  return plan;
}

/** syncUserTeamIds for each distinct uid, sequentially (rosters are small). */
export async function syncUsersTeamIds(
  db: Firestore,
  uids: Iterable<string>,
  actorUid?: string | null,
): Promise<Map<string, TeamIdsPlan>> {
  const out = new Map<string, TeamIdsPlan>();
  for (const uid of new Set(uids)) {
    if (!uid) continue;
    out.set(uid, await syncUserTeamIds(db, uid, actorUid));
  }
  return out;
}

/**
 * Whole-collection version for the backfill: one plan per profile, plus any
 * uid that has `team_members` rows but no profile.
 */
export function planBackfill(
  users: { id: string; data: Row }[],
  memberships: Row[],
): { uid: string; plan: TeamIdsPlan }[] {
  const byUser = new Map<string, Row[]>();
  for (const m of memberships) {
    const uid = m?.user_id;
    if (typeof uid !== "string" || !uid) continue;
    const list = byUser.get(uid) ?? [];
    list.push(m);
    byUser.set(uid, list);
  }
  const out: { uid: string; plan: TeamIdsPlan }[] = [];
  const seen = new Set<string>();
  for (const u of users) {
    seen.add(u.id);
    out.push({ uid: u.id, plan: planTeamIdsSync(u.data ?? {}, byUser.get(u.id) ?? []) });
  }
  for (const [uid, rows] of byUser) {
    if (!seen.has(uid)) out.push({ uid, plan: planTeamIdsSync(undefined, rows) });
  }
  return out.sort((a, b) => a.uid.localeCompare(b.uid));
}
