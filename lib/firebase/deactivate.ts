// Deactivate / reactivate a person (docs/PERMISSIONS_SPEC.md §2.6, D5).
// Admin SDK; called from app/(app)/admin/actions.ts after requireAdmin().

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import type { ItemCollection } from "@/lib/item-registry";
import {
  BATCH_LIMIT,
  checkDeactivate,
  chunk,
  planUnassign,
  type OwnedDoc,
} from "@/lib/deactivation";
import { LAST_ADMIN_MESSAGE, hasOtherAdmin } from "./admin-guard";
import { syncUserTeamIds } from "./membership";
import { emitEvent } from "./notifications";
import { leaderIdsOfTeams } from "./rock-events";

const OWNED: readonly { collection: ItemCollection; field: string }[] = [
  { collection: "rocks", field: "owner_id" },
  { collection: "todos", field: "owner_id" }, // to-dos + milestones
  { collection: "issues", field: "owner_id" },
  { collection: "scorecard_metrics", field: "owner_id" },
  { collection: "headlines", field: "created_by" },
];

async function loadOwned(db: Firestore, uid: string): Promise<OwnedDoc[]> {
  const out: OwnedDoc[] = [];
  for (const { collection, field } of OWNED) {
    const snap = await db.collection(collection).where(field, "==", uid).get();
    for (const d of snap.docs) {
      const data = d.data();
      if (collection === "headlines" && data.owner_unassigned === true) continue;
      out.push({ collection, id: d.id, data });
    }
  }
  return out;
}

export type DeactivateResult = {
  teamsRemoved: number;
  itemsUnassigned: number;
  signInDisabled: boolean;
};

export async function deactivatePerson(
  db: Firestore,
  auth: Auth,
  uid: string,
  actorUid: string,
): Promise<{ ok: true; result: DeactivateResult } | { ok: false; error: string }> {
  const account = uid ? await auth.getUser(uid).catch(() => null) : null;
  const targetIsAdmin = account?.customClaims?.role === "admin";
  const guard = checkDeactivate({
    uid,
    actorUid,
    targetIsAdmin,
    hasOtherAdmin: targetIsAdmin ? await hasOtherAdmin(auth, uid) : true,
    lastAdminMessage: LAST_ADMIN_MESSAGE,
  });
  if (!guard.ok) return guard;

  // 1. Lock the account first so they cannot act while the cascade runs.
  if (account) {
    await auth.updateUser(uid, { disabled: true });
    await auth.revokeRefreshTokens(uid);
  }

  // 2. Roster rows, speaking order / driver, profile marker.
  const memberships = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .get();
  const teamIds = memberships.docs
    .map((d) => d.data()?.team_id as string)
    .filter(Boolean);
  const batch = db.batch();
  for (const doc of memberships.docs) batch.delete(doc.ref);
  const teamDocs = teamIds.length
    ? await db.getAll(...teamIds.map((id) => db.collection("teams").doc(id)))
    : [];
  for (const team of teamDocs) {
    if (!team.exists) continue;
    const data = team.data() ?? {};
    const order = (data.speaking_order as string[]) ?? [];
    const patch: Record<string, unknown> = {};
    if (order.includes(uid)) patch.speaking_order = order.filter((id) => id !== uid);
    if (data.meeting_driver_id === uid) patch.meeting_driver_id = null;
    if (Object.keys(patch).length > 0) batch.update(team.ref, patch);
  }
  batch.set(
    db.collection("users").doc(uid),
    {
      ...(account?.email ? { email: account.email } : {}),
      ...(account?.displayName ? { display_name: account.displayName } : {}),
      deactivated_at: FieldValue.serverTimestamp(),
      deactivated_by: actorUid,
    },
    { merge: true },
  );
  await batch.commit();
  await syncUserTeamIds(db, uid);

  // 3. Unassign everything they own, in chunks.
  const plan = planUnassign(await loadOwned(db, uid));
  for (const part of chunk(plan.patches, BATCH_LIMIT)) {
    const b = db.batch();
    for (const p of part) b.update(db.collection(p.collection).doc(p.id), p.patch);
    await b.commit();
  }

  // 4. One notification per leader per team (pointing at one item of it).
  for (const g of plan.notify) {
    const leaders = (await leaderIdsOfTeams(db, [g.teamId])).filter((l) => l !== uid);
    if (leaders.length === 0) continue;
    await emitEvent(db, g.ref, null, actorUid, {
      teamId: g.teamId,
      direct: { unassigned: leaders },
    });
  }

  return {
    ok: true,
    result: {
      teamsRemoved: memberships.size,
      itemsUnassigned: plan.patches.length,
      signInDisabled: !!account,
    },
  };
}

/** Undo the disable. Items stay unassigned; roster re-add is manual. */
export async function reactivatePerson(
  db: Firestore,
  auth: Auth,
  uid: string,
): Promise<{ ok: true; signInRestored: boolean } | { ok: false; error: string }> {
  if (!uid) return { ok: false, error: "No user given" };
  const account = await auth.getUser(uid).catch(() => null);
  if (account) await auth.updateUser(uid, { disabled: false });
  await db
    .collection("users")
    .doc(uid)
    .set(
      { deactivated_at: FieldValue.delete(), deactivated_by: FieldValue.delete() },
      { merge: true },
    );
  return { ok: true, signInRestored: !!account };
}
