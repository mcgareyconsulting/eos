import { cache } from "react";
import { notFound } from "next/navigation";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { requireFirebaseUser } from "./auth";

// Mirror of lib/teams.ts `requireTeamAccess()` for Firebase. Verifies the
// current user is a member of the requested team, or an org admin (god mode).
// Otherwise 404s so team IDs aren't enumerable via error messages.
export const requireTeamAccess = cache(async (teamId: string) => {
  const { uid, isAdmin, db } = await requireFirebaseUser();

  const membership = await db
    .collection("team_members")
    .doc(`${teamId}__${uid}`)
    .get();
  if (!membership.exists && !isAdmin) notFound();

  const teamSnap = await db.collection("teams").doc(teamId).get();
  if (!teamSnap.exists) notFound();

  return {
    uid,
    db,
    isAdmin,
    team: teamFrom(teamSnap),
    membershipRole: (membership.data()?.role as string | undefined) ?? null,
  };
});

// Shape returned to callers for the current team. `meeting_driver_id` names the
// member designated to drive the live L10 (label-only — anyone can still
// advance the stage); `meet_link` is the team's standing Google Meet URL used
// by the Join button. Both are optional and null until a leader sets them.
// `speaking_order` is the team's durable L10 rotation, carried week to week;
// it is always stale relative to the roster, so read it through
// reconcileSpeakingOrder() rather than trusting it directly.
export type TeamSummary = {
  id: string;
  name: string;
  meetingDriverId: string | null;
  meetLink: string | null;
  speakingOrder: string[];
};

function teamFrom(snap: DocumentSnapshot): TeamSummary {
  const data = snap.data() ?? {};
  return {
    id: snap.id,
    name: (data.name as string) ?? "Team",
    meetingDriverId: (data.meeting_driver_id as string) ?? null,
    meetLink: (data.meet_link as string) ?? null,
    speakingOrder: (data.speaking_order as string[]) ?? [],
  };
}

// Like requireTeamAccess, but additionally requires the current user to be a
// team *leader* (role === "leader") OR an org admin. Used to gate member
// management — e.g. inviting members, role changes, meeting settings.
export const requireTeamLeader = cache(async (teamId: string) => {
  const { uid, isAdmin, db } = await requireFirebaseUser();

  const membership = await db
    .collection("team_members")
    .doc(`${teamId}__${uid}`)
    .get();
  const isLeader = membership.exists && membership.data()?.role === "leader";
  if (!isLeader && !isAdmin) notFound();

  const teamSnap = await db.collection("teams").doc(teamId).get();
  if (!teamSnap.exists) notFound();

  return {
    uid,
    db,
    isAdmin,
    team: teamFrom(teamSnap),
  };
});

/** Org admin only — create team, global admin surfaces. 404 if not admin. */
export const requireAdmin = cache(async () => {
  const user = await requireFirebaseUser();
  if (!user.isAdmin) notFound();
  return user;
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
  email?: string | null;
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
    const profileById = new Map<
      string,
      { full_name: string; email: string | null }
    >();
    for (const d of userDocs) {
      if (!d.exists) continue;
      const data = d.data() ?? {};
      const name =
        (data.display_name as string) ||
        [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
        (data.email as string) ||
        "";
      profileById.set(d.id, {
        full_name: name || "—",
        email: (data.email as string) ?? null,
      });
    }

    return members.map((m) => ({
      user_id: m.user_id,
      full_name: profileById.get(m.user_id)?.full_name ?? "—",
      role: m.role,
      email: profileById.get(m.user_id)?.email ?? null,
    }));
  },
);

export type DirectoryTeam = {
  id: string;
  name: string;
  members: TeamMember[];
};

/**
 * Org-wide directory: every team + roster. Readable by any signed-in user.
 * Does not grant access to team *data* (rocks, issues, …) — only names/roles.
 */
export const getOrgDirectory = cache(async (): Promise<DirectoryTeam[]> => {
  const { db } = await requireFirebaseUser();

  const [teamsSnap, membersSnap] = await Promise.all([
    db.collection("teams").orderBy("name").get(),
    db.collection("team_members").get(),
  ]);

  const membersByTeam = new Map<
    string,
    { user_id: string; role: string }[]
  >();
  const userIds = new Set<string>();
  for (const d of membersSnap.docs) {
    const teamId = d.data().team_id as string;
    const userId = d.data().user_id as string;
    const role = (d.data().role as string) ?? "member";
    userIds.add(userId);
    const list = membersByTeam.get(teamId) ?? [];
    list.push({ user_id: userId, role });
    membersByTeam.set(teamId, list);
  }

  const profileById = new Map<
    string,
    { full_name: string; email: string | null }
  >();
  if (userIds.size > 0) {
    // getAll is capped (~10–30 depending on client); chunk for safety.
    const ids = [...userIds];
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const docs = await db.getAll(
        ...slice.map((id) => db.collection("users").doc(id)),
      );
      for (const snap of docs) {
        if (!snap.exists) continue;
        const data = snap.data() ?? {};
        const name =
          (data.display_name as string) ||
          [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
          (data.email as string) ||
          "";
        profileById.set(snap.id, {
          full_name: name || "—",
          email: (data.email as string) ?? null,
        });
      }
    }
  }

  return teamsSnap.docs.map((t) => {
    const raw = membersByTeam.get(t.id) ?? [];
    const members: TeamMember[] = raw
      .map((m) => ({
        user_id: m.user_id,
        role: m.role,
        full_name: profileById.get(m.user_id)?.full_name ?? "—",
        email: profileById.get(m.user_id)?.email ?? null,
      }))
      .sort((a, b) => {
        if (a.role === "leader" && b.role !== "leader") return -1;
        if (a.role !== "leader" && b.role === "leader") return 1;
        return a.full_name.localeCompare(b.full_name, undefined, {
          sensitivity: "base",
        });
      });

    return {
      id: t.id,
      name: (t.data()?.name as string) ?? "Team",
      members,
    };
  });
});
