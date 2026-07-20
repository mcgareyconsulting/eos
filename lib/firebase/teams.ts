import { cache } from "react";
import { notFound } from "next/navigation";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
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
    team: teamFrom(teamSnap),
  };
});

// Shape returned to callers for the current team. `meeting_driver_id` names the
// member designated to drive the live L10 (label-only — anyone can still
// advance the stage); `meet_link` is the team's standing Google Meet URL used
// by the Join button. Both are optional and null until a leader sets them.
export type TeamSummary = {
  id: string;
  name: string;
  meetingDriverId: string | null;
  meetLink: string | null;
};

function teamFrom(snap: DocumentSnapshot): TeamSummary {
  const data = snap.data() ?? {};
  return {
    id: snap.id,
    name: (data.name as string) ?? "Team",
    meetingDriverId: (data.meeting_driver_id as string) ?? null,
    meetLink: (data.meet_link as string) ?? null,
  };
}

// Like requireTeamAccess, but additionally requires the current user to be a
// team *leader* (role === "leader"). Used to gate member management — e.g.
// approving/denying join requests. 404s for non-leaders and unknown teams.
export const requireTeamLeader = cache(async (teamId: string) => {
  const { uid, db } = await requireFirebaseUser();

  const membership = await db
    .collection("team_members")
    .doc(`${teamId}__${uid}`)
    .get();
  if (!membership.exists || membership.data()?.role !== "leader") notFound();

  const teamSnap = await db.collection("teams").doc(teamId).get();
  if (!teamSnap.exists) notFound();

  return {
    uid,
    db,
    team: teamFrom(teamSnap),
  };
});

// Fetches `${collection}/${id}` and verifies it belongs to `teamId`, 404ing
// (matching requireTeamAccess/requireTeamLeader, and the read-path guard
// pattern already used on e.g. the meeting detail page) if the doc doesn't
// exist or was created for a different team. Callers are expected to have
// already verified the *caller's* membership in `teamId` via
// requireTeamAccess/requireTeamLeader — this closes the other half of that
// check: that the entity being mutated actually lives in that team, not a
// team_id smuggled in alongside a foreign entity id. Returns the snapshot so
// callers that need the data can reuse this read instead of fetching twice.
export async function requireTeamDoc(
  db: Firestore,
  collection: string,
  id: string,
  teamId: string,
) {
  const snap = await db.collection(collection).doc(id).get();
  if (!snap.exists || snap.data()?.team_id !== teamId) notFound();
  return snap;
}

export type TeamMember = {
  user_id: string;
  full_name: string;
  role: string;
};

// Hydrates team members (user_id + display name + role). Pulls display names
// from /users/{uid} docs (which the profile-write / join approval populate).
// Falls back to "—" if the profile doc doesn't exist yet.
export const getTeamMembers = cache(
  async (teamId: string): Promise<TeamMember[]> => {
    const { db } = await requireFirebaseUser();

    const membersSnap = await db
      .collection("team_members")
      .where("team_id", "==", teamId)
      .get();

    const members = membersSnap.docs.map((d) => ({
      user_id: d.data().user_id as string,
      role: (d.data().role as string) ?? "member",
    }));
    if (members.length === 0) return [];

    const userDocs = await db.getAll(
      ...members.map((m) => db.collection("users").doc(m.user_id)),
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

    return members.map((m) => ({
      user_id: m.user_id,
      full_name: nameById.get(m.user_id) ?? "—",
      role: m.role,
    }));
  },
);
