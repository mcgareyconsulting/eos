import { FieldValue, type Firestore } from "firebase-admin/firestore";

// Auto-provision a default team + membership for users with no team yet.
// Idempotent — safe to call on every page load. Returns the user's primary
// team (first one we find them in).
export async function ensureUserHasTeam(
  db: Firestore,
  uid: string,
  displayName: string | null,
  email: string | null,
): Promise<{ teamId: string; teamName: string }> {
  const memberships = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .limit(1)
    .get();

  if (!memberships.empty) {
    const membership = memberships.docs[0].data();
    const teamSnap = await db
      .collection("teams")
      .doc(membership.team_id)
      .get();
    return {
      teamId: membership.team_id,
      teamName: teamSnap.data()?.name ?? "Team",
    };
  }

  const teamName = `${displayName ?? email ?? "My"}'s Team`;
  const teamRef = db.collection("teams").doc();
  await teamRef.set({
    name: teamName,
    org_id: "default",
    parent_team_id: null,
    created_at: FieldValue.serverTimestamp(),
  });

  await db
    .collection("team_members")
    .doc(`${teamRef.id}__${uid}`)
    .set({
      team_id: teamRef.id,
      user_id: uid,
      role: "leader",
      created_at: FieldValue.serverTimestamp(),
    });

  return { teamId: teamRef.id, teamName };
}
