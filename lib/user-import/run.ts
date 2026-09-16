// Applies a people seed to Firestore + Identity Platform.
//
// **Additive only.** The file can create people, teams and memberships, grant
// the org-admin claim, and refresh a profile's name/title. It never deletes a
// person, never drops a membership, never changes an existing membership's
// role, and never *revokes* org admin — so re-dropping last month's seed
// cannot demote anyone or empty a roster.
// What the file no longer mentions is reported (`notInFile`) for the admin to
// act on by hand on the People tab, not acted on here.
//
// Idempotent: Auth accounts resolve by email, teams by normalized name, and
// membership ids are deterministic (`${teamId}__${uid}`), so the same file
// applied twice is a no-op on the second run.

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { type CsvTable } from "../csv-import";
import { isEmailAllowed, type Allowlist } from "../auth-allowlist";
// Writer is part of `@/lib/team-import`'s public surface; imported by module
// path rather than through the barrel so this path doesn't drag in the six
// kind-importers (and node:zlib) for one batching helper.
import { Writer } from "../team-import/owners";
import type {
  SeedIssue,
  SeedPreviewRow,
  SeedReport,
} from "../user-import-types";
import { hasSeedColumns, readSeedRows } from "./normalize";
import { buildSeedPlan } from "./plan";

/**
 * The slice of firebase-admin's Auth this needs. Narrow on purpose: it makes
 * the unit tests a six-line fake instead of a mocked SDK, and `Auth` itself
 * satisfies it structurally.
 */
export type SeedAuth = {
  getUserByEmail(
    email: string,
  ): Promise<{ uid: string; customClaims?: Record<string, unknown> | null }>;
  createUser(props: { email: string; displayName?: string }): Promise<{ uid: string }>;
  setCustomUserClaims(
    uid: string,
    claims: Record<string, unknown> | null,
  ): Promise<void>;
};

export type UserImportOptions = {
  /** Default true — callers opt into writing, never out of it. */
  dryRun?: boolean;
  /**
   * Parsed SIGN_IN_ALLOWLIST. Rows outside it are reported and skipped: an
   * account that cannot pass createSession() is worse than no account, since
   * it silently owns imported work nobody can sign in to claim.
   * `null` = no allowlist configured (open sign-in), so nothing is filtered.
   */
  allowlist?: Allowlist | null;
  /** Per-pairing preview cap; the overflow is reported as a count. */
  previewLimit?: number;
};

const CHUNK = 100;

export async function runUserImport(
  db: Firestore,
  auth: SeedAuth,
  table: CsvTable,
  opts: UserImportOptions = {},
): Promise<SeedReport> {
  const dryRun = opts.dryRun !== false;
  const previewLimit = opts.previewLimit ?? 250;
  const writer = new Writer(db, dryRun);

  if (!hasSeedColumns(table)) {
    throw new Error(
      "This file has no Email column paired with a Name (or First/Last) column. " +
        "A people seed needs at least First, Last and Email.",
    );
  }

  const { rows, issues: rowIssues } = readSeedRows(table);
  const issues: SeedIssue[] = [...rowIssues];

  // Allowlist filter before planning, so a rejected address never creates the
  // team it was the only member of.
  const allowlist = opts.allowlist ?? null;
  const allowed = rows.filter((r) => {
    if (isEmailAllowed(allowlist, r.email)) return true;
    issues.push({
      line: r.line,
      label: r.email,
      reason:
        "Not on the sign-in allowlist — this address could not sign in, so no account was created.",
    });
    return false;
  });

  const existingTeams = (await db.collection("teams").get()).docs.map((d) => ({
    id: d.id,
    name: (d.data()?.name as string) ?? "",
  }));

  const plan = buildSeedPlan(allowed, existingTeams);
  issues.push(...plan.issues);

  // ---------------------------------------------------------------------
  // Teams — create the ones the org doesn't have yet
  // ---------------------------------------------------------------------

  // Ids are minted client-side, so a dry run can show real pairings (and the
  // report can name the team) without writing anything.
  const teamIdByName = new Map<string, string>();
  let teamsCreated = 0;
  let teamsMatched = 0;
  for (const t of plan.teams) {
    if (t.teamId) {
      teamsMatched++;
      teamIdByName.set(t.name, t.teamId);
      continue;
    }
    teamsCreated++;
    teamIdByName.set(t.name, db.collection("teams").doc().id);
  }

  // ---------------------------------------------------------------------
  // People — Auth account, then profile
  // ---------------------------------------------------------------------

  // `pending` marks a uid that only exists because this is a dry run — the
  // account would have been created. Carrying it (instead of skipping the
  // person) is what lets a dry run preview brand-new hires, which is the
  // whole point of previewing a seed file.
  const resolved = new Map<
    string,
    { uid: string; pending: boolean; isNew: boolean }>();
  let authCreated = 0;
  let authExisting = 0;
  let profilesWritten = 0;
  const adminsGranted: string[] = [];
  const adminsUnchanged: string[] = [];
  const adminsNotRevoked: string[] = [];

  for (const person of plan.people) {
    const fullName = `${person.firstName} ${person.lastName}`.trim();
    const found = await auth.getUserByEmail(person.email).catch(() => null);

    let uid: string;
    let pending = false;
    if (found) {
      uid = found.uid;
      authExisting++;
    } else {
      authCreated++;
      if (dryRun) {
        uid = `pending-${person.email}`;
        pending = true;
      } else {
        // No email is sent and no password is set — an empty record that
        // activates on first Google sign-in, same as `pnpm accounts:create`.
        const created = await auth.createUser({
          email: person.email,
          ...(fullName ? { displayName: fullName } : {}),
        });
        uid = created.uid;
      }
    }

    resolved.set(person.email, { uid, pending, isNew: !found });

    // ------- org-admin claim -------
    // The claim lives on Identity Platform, not Firestore, so it is set here
    // rather than through the Writer, and a dry run reports it without
    // touching anything.
    const wasAdmin = found?.customClaims?.role === "admin";
    if (person.orgAdmin && wasAdmin) {
      adminsUnchanged.push(person.email);
    } else if (person.orgAdmin) {
      adminsGranted.push(person.email);
      if (!dryRun) {
        // Merge, never replace: another claim on this account is not ours to
        // drop. Same shape as scripts/set-admin-role.ts.
        await auth.setCustomUserClaims(uid, {
          ...(found?.customClaims ?? {}),
          role: "admin",
        });
      }
    } else if (wasAdmin) {
      // The file calls them a member but they hold the claim. Additive means
      // report, not demote — revoking someone's access is not something a
      // dropped file should do silently.
      adminsNotRevoked.push(person.email);
    }

    await writer.set(["users", uid], {
      display_name: fullName,
      first_name: person.firstName,
      last_name: person.lastName,
      email: person.email,
      // Job title, when the file carries a separate column for one. Display
      // only — access comes from team_members.role and the org-admin claim.
      ...(person.title ? { title: person.title } : {}),
      created_via: "user-import",
    });
    profilesWritten++;
  }

  // ---------------------------------------------------------------------
  // Memberships — create only what's missing
  // ---------------------------------------------------------------------

  const pairs: {
    email: string;
    teamName: string;
    teamId: string;
    uid: string;
    pending: boolean;
  }[] = [];
  for (const person of plan.people) {
    const who = resolved.get(person.email);
    if (!who) continue;
    for (const teamName of person.teams) {
      const teamId = teamIdByName.get(teamName);
      if (teamId) {
        pairs.push({
          email: person.email,
          teamName,
          teamId,
          uid: who.uid,
          pending: who.pending,
        });
      }
    }
  }

  // A pending uid belongs to an account that does not exist yet, so it can
  // have no membership — don't spend a read proving it.
  const existingMembership = new Set<string>();
  const memberIds = pairs
    .filter((p) => !p.pending)
    .map((p) => `${p.teamId}__${p.uid}`);
  for (let i = 0; i < memberIds.length; i += CHUNK) {
    const refs = memberIds
      .slice(i, i + CHUNK)
      .map((id) => db.collection("team_members").doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) if (snap.exists) existingMembership.add(snap.id);
  }

  let membershipsCreated = 0;
  let membershipsExisting = 0;
  const preview: SeedPreviewRow[] = [];
  let previewTruncated = 0;
  const nameByEmail = new Map(
    plan.people.map((p) => [p.email, `${p.firstName} ${p.lastName}`.trim() || p.email]),
  );
  const titleByEmail = new Map(plan.people.map((p) => [p.email, p.title]));
  const adminByEmail = new Map(plan.people.map((p) => [p.email, p.orgAdmin]));

  const addPreview = (row: SeedPreviewRow) => {
    if (preview.length < previewLimit) preview.push(row);
    else previewTruncated++;
  };

  for (const pair of pairs) {
    const id = `${pair.teamId}__${pair.uid}`;
    const already = existingMembership.has(id);
    if (already) {
      membershipsExisting++;
      addPreview({
        action: "skip",
        name: nameByEmail.get(pair.email) ?? pair.email,
        email: pair.email,
        team: pair.teamName,
        orgAdmin: adminByEmail.get(pair.email) ?? false,
        title: titleByEmail.get(pair.email) ?? null,
        note: "Already on this team — role left as it is.",
      });
      continue;
    }

    membershipsCreated++;
    await writer.set(["team_members", id], {
      team_id: pair.teamId,
      user_id: pair.uid,
      // Always `member`. The file's Role column is a job title, not a
      // permission — leadership is granted on the Members tab.
      role: "member",
      created_at: FieldValue.serverTimestamp(),
    });
    addPreview({
      action: "create",
      name: nameByEmail.get(pair.email) ?? pair.email,
      email: pair.email,
      team: pair.teamName,
      orgAdmin: adminByEmail.get(pair.email) ?? false,
      title: titleByEmail.get(pair.email) ?? null,
    });
  }

  // People the file names but gives no team.
  for (const person of plan.people) {
    if (person.teams.length > 0) continue;
    addPreview({
      action: resolved.get(person.email)?.isNew ? "create" : "update",
      name: nameByEmail.get(person.email) ?? person.email,
      email: person.email,
      team: "—",
      orgAdmin: person.orgAdmin,
      title: person.title,
      note: "No team in the file — profile only, joins no roster.",
    });
  }

  // Write the team docs last: a team is only worth creating if the people it
  // was planned for made it this far.
  for (const t of plan.teams) {
    if (t.teamId) continue;
    const teamId = teamIdByName.get(t.name)!;
    const seats = pairs.filter((p) => p.teamId === teamId).map((p) => p.uid);
    await writer.set(["teams", teamId], {
      name: t.name,
      org_id: "default",
      parent_team_id: null,
      meeting_driver_id: null,
      meet_link: null,
      // Seed the L10 rotation with the roster the file gives it; it is
      // reconciled against the live roster on read anyway.
      speaking_order: seats,
      created_at: FieldValue.serverTimestamp(),
    });
  }

  await writer.flush();

  // ---------------------------------------------------------------------
  // Review lists — who the file left out, and which teams have no leader
  // ---------------------------------------------------------------------

  const { notInFile, leaderless } = await reviewLists(db, plan.teams, teamIdByName, pairs);

  return {
    dryRun,
    writes: writer.written,
    teams: {
      created: teamsCreated,
      matched: teamsMatched,
      names: plan.teams.map((t) => ({ name: t.name, action: t.action })),
    },
    people: { authCreated, authExisting, profilesWritten },
    memberships: { created: membershipsCreated, existing: membershipsExisting },
    orgAdmins: {
      granted: adminsGranted,
      unchanged: adminsUnchanged,
      notRevoked: adminsNotRevoked,
    },
    unrecognizedAccess: [
      ...new Set(
        allowed
          .map((r) => r.unrecognizedAccess)
          .filter((v): v is string => !!v),
      ),
    ],
    leaderless,
    notInFile,
    issues,
    rows: preview,
    previewTruncated,
  };
}

/**
 * For every team the file touches: who is on the roster in the app but not in
 * the file, and does the team have a leader. Both are read *after* the writes
 * so an applied run reports the state the admin will actually see.
 *
 * A team this run created is leaderless by construction — the file grants org
 * admin but never team leadership — so it is reported without a query. An org
 * admin can still manage it; a team leader is what it lacks.
 */
async function reviewLists(
  db: Firestore,
  teams: { name: string; teamId: string | null }[],
  teamIdByName: Map<string, string>,
  pairs: { teamId: string; uid: string }[],
): Promise<{ notInFile: { team: string; names: string[] }[]; leaderless: string[] }> {
  const notInFile: { team: string; names: string[] }[] = [];
  const leaderless: string[] = [];

  const seededUids = new Map<string, Set<string>>();
  for (const p of pairs) {
    const set = seededUids.get(p.teamId) ?? new Set<string>();
    set.add(p.uid);
    seededUids.set(p.teamId, set);
  }

  for (const team of teams) {
    if (!team.teamId) {
      // Newly created — nobody predates the file, and it has no leader yet.
      leaderless.push(team.name);
      continue;
    }
    const teamId = teamIdByName.get(team.name)!;
    const roster = await db
      .collection("team_members")
      .where("team_id", "==", teamId)
      .get();

    if (!roster.docs.some((d) => d.data()?.role === "leader")) {
      leaderless.push(team.name);
    }

    const inFile = seededUids.get(teamId) ?? new Set<string>();
    const strangers = roster.docs
      .map((d) => d.data()?.user_id as string)
      .filter((uid) => uid && !inFile.has(uid));
    if (strangers.length === 0) continue;

    // Chunked rather than capped: this list is the only place a person the
    // file forgot is named, so dropping the overflow would hide exactly the
    // people it exists to surface.
    const names: string[] = [];
    for (let i = 0; i < strangers.length; i += CHUNK) {
      const slice = strangers.slice(i, i + CHUNK);
      const docs = await db.getAll(
        ...slice.map((uid) => db.collection("users").doc(uid)),
      );
      docs.forEach((d, j) => {
        const data = d.data() ?? {};
        names.push(
          (data.display_name as string) ||
            [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
            (data.email as string) ||
            slice[j],
        );
      });
    }
    notInFile.push({ team: team.name, names: names.sort() });
  }

  return { notInFile, leaderless };
}
