import { cache } from "react";
import { requireAdmin } from "./teams";
import { getAdminAuth } from "./admin";

/**
 * One person as the admin console sees them: profile, rosters, and whether
 * they can actually sign in.
 *
 * `hasAuth` and `isOrgAdmin` come from Identity Platform, not Firestore —
 * they are the difference between a real person and the placeholder rows a
 * data import leaves behind (`import-*` uids with no account), which the
 * admin needs to tell apart before deleting anything.
 */
export type OrgPerson = {
  uid: string;
  name: string;
  email: string | null;
  /** Job title from the seed file's Role column. Never a permission. */
  title: string | null;
  teams: { id: string; name: string; role: string }[];
  /** Has an Identity Platform account, so could sign in. */
  hasAuth: boolean;
  /** Holds the org-admin custom claim. */
  isOrgAdmin: boolean;
  /** Has signed in at least once. */
  hasSignedIn: boolean;
  /** "user-import" / "csv-import" — how the profile doc got here. */
  createdVia: string | null;
  /** Set by an admin delete; access is gone but the name still renders. */
  deactivated: boolean;
};

function displayNameOf(data: Record<string, unknown>, fallback: string): string {
  return (
    (data.display_name as string) ||
    [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
    (data.email as string) ||
    fallback
  );
}

/**
 * Everyone the org knows about — the **union** of `/users` profiles and
 * Identity Platform accounts, not either alone.
 *
 * Both halves are needed and neither is a superset: someone who signed in
 * without ever being invited has an account and no profile doc, while an
 * import placeholder has a profile doc and no account. Listing one source
 * would quietly hide a class of person from the only screen that can fix
 * them.
 */
export const getOrgPeople = cache(async (): Promise<OrgPerson[]> => {
  const { db } = await requireAdmin();

  const [usersSnap, membersSnap, teamsSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("team_members").get(),
    db.collection("teams").get(),
  ]);

  const teamNameById = new Map(
    teamsSnap.docs.map((d) => [d.id, (d.data()?.name as string) ?? "Team"]),
  );

  const teamsByUid = new Map<string, OrgPerson["teams"]>();
  for (const d of membersSnap.docs) {
    const uid = d.data()?.user_id as string;
    const teamId = d.data()?.team_id as string;
    if (!uid || !teamId) continue;
    const list = teamsByUid.get(uid) ?? [];
    list.push({
      id: teamId,
      name: teamNameById.get(teamId) ?? "Team",
      role: (d.data()?.role as string) ?? "member",
    });
    teamsByUid.set(uid, list);
  }

  const auth = getAdminAuth();
  const authByUid = new Map<
    string,
    { email: string | null; isAdmin: boolean; signedIn: boolean; name: string | null }
  >();
  let page = await auth.listUsers(1000);
  for (;;) {
    for (const u of page.users) {
      authByUid.set(u.uid, {
        email: u.email ?? null,
        isAdmin: u.customClaims?.role === "admin",
        signedIn: !!u.metadata.lastSignInTime,
        name: u.displayName ?? null,
      });
    }
    if (!page.pageToken) break;
    page = await auth.listUsers(1000, page.pageToken);
  }

  const people = new Map<string, OrgPerson>();

  for (const doc of usersSnap.docs) {
    const data = doc.data() ?? {};
    const account = authByUid.get(doc.id);
    people.set(doc.id, {
      uid: doc.id,
      name: displayNameOf(data, account?.name || doc.id),
      email: (data.email as string) ?? account?.email ?? null,
      title: (data.title as string) ?? null,
      teams: teamsByUid.get(doc.id) ?? [],
      hasAuth: !!account,
      isOrgAdmin: account?.isAdmin ?? false,
      hasSignedIn: account?.signedIn ?? false,
      createdVia: (data.created_via as string) ?? null,
      deactivated: !!data.deactivated_at,
    });
  }

  // Accounts with no profile doc yet — real people who signed in before
  // anyone invited them. They own nothing until they do, but the admin still
  // has to be able to see and place them.
  for (const [uid, account] of authByUid) {
    if (people.has(uid)) continue;
    people.set(uid, {
      uid,
      name: account.name || account.email || uid,
      email: account.email,
      title: null,
      teams: teamsByUid.get(uid) ?? [],
      hasAuth: true,
      isOrgAdmin: account.isAdmin,
      hasSignedIn: account.signedIn,
      createdVia: null,
      deactivated: false,
    });
  }

  return [...people.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
});

export type AdminTeam = {
  id: string;
  name: string;
  memberCount: number;
  leaderCount: number;
};

/** Every team with roster counts — the Teams tab of the admin console. */
export const getAdminTeams = cache(async (): Promise<AdminTeam[]> => {
  const { db } = await requireAdmin();

  const [teamsSnap, membersSnap] = await Promise.all([
    db.collection("teams").orderBy("name").get(),
    db.collection("team_members").get(),
  ]);

  const counts = new Map<string, { members: number; leaders: number }>();
  for (const d of membersSnap.docs) {
    const teamId = d.data()?.team_id as string;
    if (!teamId) continue;
    const c = counts.get(teamId) ?? { members: 0, leaders: 0 };
    c.members++;
    if (d.data()?.role === "leader") c.leaders++;
    counts.set(teamId, c);
  }

  return teamsSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data()?.name as string) ?? "Team",
    memberCount: counts.get(d.id)?.members ?? 0,
    leaderCount: counts.get(d.id)?.leaders ?? 0,
  }));
});
