// Who is in the room right now — the server half of `presentInRoom`.
//
// Used by every notification fan-out on a team entity: an event that
// happens while the team's L10 is live is not news to the people sitting in
// it, so they get no inbox row for it (lib/notifications.ts recipientsFor).
// The activity trace is written regardless.

import type { Firestore } from "firebase-admin/firestore";
import { presentInRoom } from "@/lib/notifications";
import { getTeamMembers } from "./teams";

/**
 * Uids present in the team's live meeting, or null when there is none.
 * Best-effort: a read failure means "no room", never a failed action — the
 * worst case is a bell someone did not need.
 */
export async function liveMeetingRoom(
  db: Firestore,
  teamId: string,
): Promise<Set<string> | null> {
  try {
    const live = await db
      .collection("meetings")
      .where("team_id", "==", teamId)
      .where("ended_at", "==", null)
      .limit(1)
      .get();
    if (live.empty) return null;
    const roster = (await getTeamMembers(teamId)).map((m) => m.user_id);
    return presentInRoom(roster, {
      absent_user_ids: live.docs[0].data()?.absent_user_ids as
        | string[]
        | undefined,
    });
  } catch (e) {
    console.error(`[meeting-room] live room lookup failed for ${teamId}:`, e);
    return null;
  }
}
