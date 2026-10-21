// Rock notification writes (Admin SDK; server only) — the Firestore half of
// lib/rock-notify.ts. Lives here, not in rocks/actions.ts, because a
// "use server" file exports only server actions and these take a `db`.

import type { Firestore } from "firebase-admin/firestore";
import { chunkForInQuery } from "@/lib/firestore-in";
import { emitEvent } from "./notifications";

/** The leaders of the given teams (deduplicated). */
export async function leaderIdsOfTeams(
  db: Firestore,
  teamIds: readonly string[],
): Promise<string[]> {
  const out = new Set<string>();
  for (const ids of chunkForInQuery([...teamIds])) {
    const snap = await db.collection("team_members").where("team_id", "in", ids).get();
    for (const d of snap.docs) {
      const x = d.data();
      if (x.role === "leader" && typeof x.user_id === "string") out.add(x.user_id);
    }
  }
  return [...out];
}

/**
 * A leader added people / teams to a rock's audience: tell each person, and
 * the leaders of each team (spec §5.3). Call after the save commits; the
 * send-time check then sees the new audience. Never throws.
 */
export async function emitAudienceAdded(
  db: Firestore,
  rockId: string,
  actorUid: string,
  teamId: string,
  added: { userIds: readonly string[]; teamIds: readonly string[] },
): Promise<void> {
  try {
    const leaders =
      added.teamIds.length > 0 ? await leaderIdsOfTeams(db, added.teamIds) : [];
    const recipients = [...new Set([...added.userIds, ...leaders])];
    if (recipients.length === 0) return;
    await emitEvent(db, { type: "rock", id: rockId }, null, actorUid, {
      teamId,
      direct: { audience_added: recipients },
    });
  } catch (e) {
    console.error(`[rock-events] audience_added on rock/${rockId} failed:`, e);
  }
}

/**
 * A milestone of the rock was ticked done: tell the rock's followers.
 * SPEC P8a / P9: call this from the milestone tick path (todos/actions.ts),
 * after the tick commits, when the todo has a `source_rock_id`.
 */
export async function rockMilestoneCompleted(
  db: Firestore,
  rockId: string,
  actorUid: string,
  teamId = "",
): Promise<void> {
  await emitEvent(db, { type: "rock", id: rockId }, "milestone_completed", actorUid, {
    teamId,
  });
}
