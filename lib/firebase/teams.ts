import { cache } from "react";
import { notFound } from "next/navigation";
import { requireFirebaseUser } from "./auth";

// Mirror of lib/teams.ts `requireTeamAccess()` for Firebase. Verifies the
// current user is a member of the requested team, otherwise 404s.
export const requireTeamAccess = cache(async (teamId: string) => {
  const { uid, db } = await requireFirebaseUser();

  const membership = await db
    .collection("team_members")
    .doc(`${teamId}__${uid}`)
    .get();
  if (!membership.exists) notFound();

  const teamSnap = await db.collection("teams").doc(teamId).get();
  if (!teamSnap.exists) notFound();

  return {
    uid,
    db,
    team: {
      id: teamSnap.id,
      name: (teamSnap.data()?.name as string) ?? "Team",
    },
  };
});

export type TeamMember = {
  user_id: string;
  full_name: string;
};

// Hydrates team members (user_id + display name). Pulls display names from
// /users/{uid} docs (which the smoke profile-write populated). Falls back
// to "—" if the profile doc doesn't exist yet.
export const getTeamMembers = cache(
  async (teamId: string): Promise<TeamMember[]> => {
    const { db } = await requireFirebaseUser();

    const membersSnap = await db
      .collection("team_members")
      .where("team_id", "==", teamId)
      .get();

    const userIds = membersSnap.docs.map((d) => d.data().user_id as string);
    if (userIds.length === 0) return [];

    const userDocs = await db.getAll(
      ...userIds.map((id) => db.collection("users").doc(id)),
    );
    const nameById = new Map<string, string>();
    for (const d of userDocs) {
      if (!d.exists) continue;
      const data = d.data() ?? {};
      const name =
        (data.display_name as string) ||
        [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
        (data.email as string) ||
        "";
      nameById.set(d.id, name || "—");
    }

    return userIds.map((id) => ({
      user_id: id,
      full_name: nameById.get(id) ?? "—",
    }));
  },
);
