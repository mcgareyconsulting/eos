import { cache } from "react";
import { redirect } from "next/navigation";
import { tokenIsAdmin } from "./admin-claim";
import { getAdminDb } from "./admin";
import { verifySession } from "./session";

export { tokenIsAdmin } from "./admin-claim";

// Resolves the current Firebase session user. Per-request de-duped via
// React cache() so layout + page share a single session verification.
export const requireFirebaseUser = cache(async () => {
  const decoded = await verifySession();
  if (!decoded) redirect("/login");
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    name: decoded.name ?? null,
    picture: decoded.picture ?? null,
    isAdmin: tokenIsAdmin(decoded),
    db: getAdminDb(),
  };
});

// Returns the user/profile/teams structure that AppShell + home expect,
// hydrated from Firebase Auth claims + Firestore.
//
// `teams` is what the sidebar can open for *data*:
//   - normal users: only membership teams
//   - org admins: every team (god-mode navigation)
// `membershipTeamIds` is always the real roster rows for this user (even when
// admin), so Directory can distinguish "on this team" vs "admin access only".
//
// Teamless non-admins stay in the app shell (Directory is visible); they are
// no longer forced through a self-serve /join request list.
export const getUserTeamsFirebase = cache(async () => {
  const { uid, name, email, picture, isAdmin, db } = await requireFirebaseUser();

  const membershipsSnap = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .get();

  const membershipTeamIds = membershipsSnap.docs.map(
    (d) => d.data().team_id as string,
  );

  // Teams this user leads — drives leader-only surfaces in the shell (e.g.
  // the Import nav link). Admins bypass this via isAdmin.
  const leaderTeamIds = membershipsSnap.docs
    .filter((d) => d.data().role === "leader")
    .map((d) => d.data().team_id as string);

  let teams: { id: string; name: string }[];

  if (isAdmin) {
    const allSnap = await db.collection("teams").orderBy("name").get();
    teams = allSnap.docs.map((d) => ({
      id: d.id,
      name: (d.data()?.name as string) ?? "Team",
    }));
  } else if (membershipTeamIds.length > 0) {
    const teamDocs = await db.getAll(
      ...membershipTeamIds.map((id) => db.collection("teams").doc(id)),
    );
    teams = teamDocs
      .filter((d) => d.exists)
      .map((d) => ({ id: d.id, name: (d.data()?.name as string) ?? "Team" }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
  } else {
    teams = [];
  }

  const fullName = (name ?? email ?? "").trim();
  const [firstName, ...rest] = fullName.split(/\s+/);
  const lastName = rest.join(" ");

  return {
    user: { id: uid, email: email ?? "" },
    profile: {
      id: uid,
      full_name: fullName,
      first_name: firstName ?? "",
      last_name: lastName,
      email: email ?? "",
      picture: picture ?? null,
    },
    teams,
    membershipTeamIds,
    leaderTeamIds,
    isAdmin,
    db,
  };
});
