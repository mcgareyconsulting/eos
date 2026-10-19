import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";

/**
 * The team-page access rule, without the 404: the caller is on the team's
 * roster (`team_members/{teamId}__{uid}`) or is an org admin, and the team
 * exists. `requireTeamAccess` (lib/firebase/teams.ts) is this plus
 * notFound() and the admin-view log; the data export (lib/export) uses it
 * directly so an export of a team page is gated by exactly the rule that
 * gates the page.
 *
 * Leaf module (no next/*, no session) so pure callers and their tests can
 * import it.
 */
export async function checkTeamAccess(
  db: Firestore,
  teamId: string,
  uid: string,
  isAdmin: boolean,
): Promise<
  | { ok: true; membership: DocumentSnapshot; teamSnap: DocumentSnapshot }
  | { ok: false }
> {
  const membership = await db
    .collection("team_members")
    .doc(`${teamId}__${uid}`)
    .get();
  if (!membership.exists && !isAdmin) return { ok: false };

  const teamSnap = await db.collection("teams").doc(teamId).get();
  if (!teamSnap.exists) return { ok: false };

  return { ok: true, membership, teamSnap };
}
