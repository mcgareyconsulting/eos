import { requireTeamDoc, requireTeamLeader, type TeamsDeps } from "./teams";

/**
 * Delete a meeting and its effectiveness ratings. Leader or org admin only
 * (C-02, docs/SECURITY_AUDIT_2026-09-08.md): destroying a team's meeting
 * history — and, for a live meeting, the room everyone is sitting in — is not
 * the same kind of act as driving one, so opening Start to every member does
 * not open this with it. A plain member, a non-member, or a meeting from
 * another team gets a 404. firestore.rules allows no client deletes at all.
 */
export async function deleteMeetingAsLeader(
  teamId: string,
  meetingId: string,
  deps: TeamsDeps = {},
): Promise<void> {
  // Forward `deps` only when a test injected one — requireTeamLeader is
  // cache()'d, and a fresh `{}` would miss the per-request cache.
  const { db } = deps.user
    ? await requireTeamLeader(teamId, deps)
    : await requireTeamLeader(teamId);
  await requireTeamDoc(db, "meetings", meetingId, teamId);
  const scores = await db
    .collection("meetings")
    .doc(meetingId)
    .collection("effectiveness_scores")
    .get();
  const batch = db.batch();
  scores.docs.forEach((r) => batch.delete(r.ref));
  batch.delete(db.collection("meetings").doc(meetingId));
  await batch.commit();
}
