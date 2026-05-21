import { cache } from "react";
import { redirect } from "next/navigation";
import { getAdminDb } from "./admin";
import { verifySession } from "./session";
import { ensureUserHasTeam } from "./team-provision";

// Mirror of lib/auth.ts (Supabase) for Firebase. Per-request de-duped via
// React cache() so layout + page share a single session verification.
export const requireFirebaseUser = cache(async () => {
  const decoded = await verifySession();
  if (!decoded) redirect("/login");
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    name: decoded.name ?? null,
    picture: decoded.picture ?? null,
    db: getAdminDb(),
  };
});

// Shape-compatible replacement for lib/auth.ts `getUserTeams()`. Returns
// the same user/profile/teams structure that AppShell + my90 already expect,
// hydrated from Firebase Auth claims + Firestore. Auto-provisions a default
// team on first call so new users never see an empty app.
export const getUserTeamsFirebase = cache(async () => {
  const { uid, name, email, picture, db } = await requireFirebaseUser();

  // Guarantee at least one team exists for this user (idempotent).
  await ensureUserHasTeam(db, uid, name, email);

  // Load all the user's team memberships, then hydrate the teams.
  const membershipsSnap = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .get();

  const teamIds = membershipsSnap.docs.map(
    (d) => d.data().team_id as string,
  );

  const teamDocs = teamIds.length
    ? await db.getAll(
        ...teamIds.map((id) => db.collection("teams").doc(id)),
      )
    : [];

  const teams = teamDocs
    .filter((d) => d.exists)
    .map((d) => ({ id: d.id, name: (d.data()?.name as string) ?? "Team" }));

  // Build a Supabase-shaped profile so AppShell renders without changes.
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
    db,
  };
});
