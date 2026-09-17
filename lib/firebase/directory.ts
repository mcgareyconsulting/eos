import { cache } from "react";
import { requireFirebaseUser } from "./auth";
import { getAdminAuth } from "./admin";
import { splitFullName } from "@/lib/user-import/normalize";

// Test-only seam, same shape as lib/firebase/teams.ts: production call
// sites never pass `deps`.
type DirectoryDeps = {
  user?: typeof requireFirebaseUser;
  auth?: typeof getAdminAuth;
};

/**
 * One row of the org Directory — the seed file's columns (First, Last, Team,
 * Role access, Email) resolved against what the app actually holds.
 *
 * `access` is what the seed file's Role access column *means* once imported:
 * the org-admin claim, or leading at least one team, or neither. It is
 * derived per row rather than stored, so it cannot drift from the claim and
 * roster rows that actually grant anything.
 */
export type DirectoryPerson = {
  uid: string;
  firstName: string;
  lastName: string;
  email: string | null;
  teams: { id: string; name: string; role: string }[];
  access: "admin" | "leader" | "member";
  /** Has an Identity Platform account, so could sign in. */
  hasAuth: boolean;
  /** Has signed in at least once. */
  hasSignedIn: boolean;
};

function namePartsOf(
  data: Record<string, unknown>,
  fallbackDisplayName: string | null,
): { first: string; last: string } {
  const first = ((data.first_name as string) ?? "").trim();
  const last = ((data.last_name as string) ?? "").trim();
  if (first || last) return { first, last };
  return splitFullName(
    (data.display_name as string) || fallbackDisplayName || "",
  );
}

/**
 * Everyone in the org, one row each — the **union** of `/users` profiles and
 * Identity Platform accounts, the way the old admin People tab built it,
 * because neither source is a superset of the other: an import placeholder
 * has a profile and no account, someone who signed in uninvited has an
 * account and no profile.
 *
 * Readable by every signed-in user (soft tenancy: names, emails and rosters
 * were already org-visible on the Members → All teams tab this replaces).
 * Deactivated profiles are left out — they exist only so owned work keeps a
 * name, and are not people anyone can reach.
 */
export const getDirectoryPeople = cache(
  async (deps: DirectoryDeps = {}): Promise<DirectoryPerson[]> => {
    const { db } = await (deps.user ?? requireFirebaseUser)();

    const [usersSnap, membersSnap, teamsSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("team_members").get(),
      db.collection("teams").get(),
    ]);

    const teamNameById = new Map(
      teamsSnap.docs.map((d) => [d.id, (d.data()?.name as string) ?? "Team"]),
    );

    const teamsByUid = new Map<string, DirectoryPerson["teams"]>();
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

    const auth = (deps.auth ?? getAdminAuth)();
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
          signedIn: !!u.metadata?.lastSignInTime,
          name: u.displayName ?? null,
        });
      }
      if (!page.pageToken) break;
      page = await auth.listUsers(1000, page.pageToken);
    }

    const accessOf = (
      isAdmin: boolean,
      teams: DirectoryPerson["teams"],
    ): DirectoryPerson["access"] =>
      isAdmin
        ? "admin"
        : teams.some((t) => t.role === "leader")
          ? "leader"
          : "member";

    const people = new Map<string, DirectoryPerson>();
    // A tombstoned profile must also block its account (if the delete left
    // one behind) from re-entering below as an "uninvited sign-in".
    const deactivated = new Set<string>();

    for (const doc of usersSnap.docs) {
      const data = doc.data() ?? {};
      if (data.deactivated_at) {
        deactivated.add(doc.id);
        continue;
      }
      const account = authByUid.get(doc.id);
      const { first, last } = namePartsOf(data, account?.name ?? null);
      const teams = teamsByUid.get(doc.id) ?? [];
      people.set(doc.id, {
        uid: doc.id,
        firstName: first,
        lastName: last,
        email: (data.email as string) ?? account?.email ?? null,
        teams,
        access: accessOf(account?.isAdmin ?? false, teams),
        hasAuth: !!account,
        hasSignedIn: account?.signedIn ?? false,
      });
    }

    // Accounts with no profile doc yet — real people who signed in before
    // anyone invited them.
    for (const [uid, account] of authByUid) {
      if (people.has(uid) || deactivated.has(uid)) continue;
      const { first, last } = splitFullName(account.name ?? "");
      const teams = teamsByUid.get(uid) ?? [];
      people.set(uid, {
        uid,
        firstName: first,
        lastName: last,
        email: account.email,
        teams,
        access: accessOf(account.isAdmin, teams),
        hasAuth: true,
        hasSignedIn: account.signedIn,
      });
    }

    for (const p of people.values()) {
      p.teams.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    }

    // Last name first, the way a roster reads; someone with no name at all
    // (an uninvited sign-in with no display name) sorts by email so they
    // don't float to the top as blanks.
    const sortKey = (p: DirectoryPerson) =>
      `${p.lastName} ${p.firstName}`.trim() || p.email || p.uid;
    return [...people.values()].sort((a, b) =>
      sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: "base" }),
    );
  },
);
