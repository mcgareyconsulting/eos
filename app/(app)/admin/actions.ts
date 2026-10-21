"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/firebase/teams";
import { setFeedbackAccess } from "@/lib/firebase/feedback-access";
import { normalizeKey } from "@/lib/csv-import";
import { assertAnotherAdminRemains } from "@/lib/firebase/admin-guard";
import { deactivatePerson, reactivatePerson } from "@/lib/firebase/deactivate";
import { assertInviteEmail, ensureAuthUser } from "@/lib/team-invite";
import { syncUserTeamIds } from "@/lib/firebase/membership";
import { stamp, stampBeforeDelete } from "@/lib/audit-stamp";
import { recordAccessChange, type AccessChangeInput } from "@/lib/access-audit";
import type { AdminResult, DeleteResult } from "./action-types";

function revalidateOrg() {
  revalidatePath("/directory");
  revalidatePath("/home");
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

type TeamRole = "leader" | "member";

function isTeamRole(v: unknown): v is TeamRole {
  return v === "leader" || v === "member";
}

/** One row of the Edit-person form: which teams, and leader on which. A
 *  "use server" module may only export async functions, so this stays local. */
type PersonTeamInput = { id: string; role: TeamRole };

/**
 * Write the roster rows one person's team list implies, given what they have
 * now: add, remove, and re-role. Removing also drops them from the team's
 * speaking order and meeting-driver slot, same as a full delete does — a
 * stale uid there is what makes the meeting driver "lose the wheel".
 */
async function applyTeams(
  db: Awaited<ReturnType<typeof requireAdmin>>["db"],
  /** The admin making the change - stamped and logged for the audit trail. */
  actorUid: string,
  uid: string,
  wanted: PersonTeamInput[],
  /** Only add and re-role; keep teams the form doesn't mention. */
  additive = false,
): Promise<{ added: number; removed: number; reroled: number }> {
  const current = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .get();
  const currentByTeam = new Map(
    current.docs.map((d) => [d.data()?.team_id as string, d]),
  );
  const wantedByTeam = new Map(wanted.map((t) => [t.id, t.role]));

  const batch = db.batch();
  let added = 0;
  let removed = 0;
  let reroled = 0;
  const accessLog: AccessChangeInput[] = [];

  for (const [teamId, role] of wantedByTeam) {
    const existing = currentByTeam.get(teamId);
    if (!existing) {
      batch.set(db.collection("team_members").doc(`${teamId}__${uid}`), {
        team_id: teamId,
        user_id: uid,
        role,
        created_at: FieldValue.serverTimestamp(),
        ...stamp(actorUid),
      });
      added++;
      accessLog.push({
        kind: "roster",
        actorUid,
        entityId: `${teamId}__${uid}`,
        teamId,
        targetUid: uid,
        before: { on_roster: false },
        after: { on_roster: true, role },
      });
    } else if (existing.data()?.role !== role) {
      const prev = (existing.data()?.role as string | undefined) ?? "member";
      batch.update(existing.ref, { role, ...stamp(actorUid) });
      reroled++;
      accessLog.push({
        kind: "leader_role",
        actorUid,
        entityId: `${teamId}__${uid}`,
        teamId,
        targetUid: uid,
        before: { role: prev },
        after: { role },
      });
    }
  }

  const droppedTeamIds: string[] = [];
  const droppedRefs: (typeof current.docs)[number]["ref"][] = [];
  for (const [teamId, doc] of currentByTeam) {
    if (additive || wantedByTeam.has(teamId)) continue;
    batch.delete(doc.ref);
    droppedRefs.push(doc.ref);
    accessLog.push({
      kind: "roster",
      actorUid,
      entityId: doc.id,
      teamId,
      targetUid: uid,
      before: { on_roster: true, role: (doc.data()?.role as string) ?? "member" },
      after: { on_roster: false },
    });
    droppedTeamIds.push(teamId);
    removed++;
  }

  if (droppedTeamIds.length > 0) {
    const teamDocs = await db.getAll(
      ...droppedTeamIds.map((id) => db.collection("teams").doc(id)),
    );
    for (const team of teamDocs) {
      if (!team.exists) continue;
      const data = team.data() ?? {};
      const order = (data.speaking_order as string[]) ?? [];
      const patch: Record<string, unknown> = {};
      if (order.includes(uid)) patch.speaking_order = order.filter((id) => id !== uid);
      if (data.meeting_driver_id === uid) patch.meeting_driver_id = null;
      if (Object.keys(patch).length > 0) {
        batch.update(team.ref, { ...patch, ...stamp(actorUid) });
      }
    }
  }

  await stampBeforeDelete(droppedRefs, actorUid);
  await batch.commit();
  await syncUserTeamIds(db, uid, actorUid);
  await Promise.all(accessLog.map((e) => recordAccessChange(db, e)));
  return { added, removed, reroled };
}

/**
 * Grant or revoke the org-admin claim. Merges rather than replaces the
 * account's claims (same shape as scripts/set-admin-role.ts). Returns whether
 * anything changed; throws when there is no account to put a claim on.
 */
async function setOrgAdmin(
  db: Awaited<ReturnType<typeof requireAdmin>>["db"],
  actorUid: string,
  uid: string,
  orgAdmin: boolean,
): Promise<boolean> {
  const auth = getAdminAuth();
  const account = await auth.getUser(uid).catch(() => null);
  if (!account) {
    if (!orgAdmin) return false;
    throw new Error(
      "They have no sign-in account yet, so there is nothing to make an admin. Add them with an email first.",
    );
  }
  const isAdmin = account.customClaims?.role === "admin";
  if (isAdmin === orgAdmin) return false;
  const claims = { ...(account.customClaims ?? {}) };
  if (orgAdmin) claims.role = "admin";
  else {
    await assertAnotherAdminRemains(auth, uid);
    delete claims.role;
  }
  await auth.setCustomUserClaims(uid, claims);
  // Claims ride on the ID token; revoke so the change takes effect on the
  // next request instead of when the old token/session cookie expires.
  await auth.revokeRefreshTokens(uid);
  await recordAccessChange(db, {
    kind: "admin_role",
    actorUid,
    entityId: uid,
    targetUid: uid,
    before: { admin: isAdmin },
    after: { admin: orgAdmin },
  });
  return true;
}

function readTeams(formData: FormData): PersonTeamInput[] | { error: string } {
  const out: PersonTeamInput[] = [];
  const seen = new Set<string>();
  for (const raw of formData.getAll("team")) {
    // "teamId:role", one entry per checked team.
    const [id, roleRaw] = String(raw).split(":");
    if (!id || seen.has(id)) continue;
    if (!isTeamRole(roleRaw)) return { error: "Role must be leader or member" };
    seen.add(id);
    out.push({ id, role: roleRaw });
  }
  return out;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Add one person org-wide: Auth record + `/users` profile, roster rows for
 * every team checked, and the admin claim if asked. Same pre-provision path
 * as the seed import, so both produce identical documents.
 *
 * Nobody is emailed — this is an empty account that activates on the person's
 * first Google sign-in.
 */
export async function addOrgPerson(formData: FormData): Promise<AdminResult> {
  // Outside try so Next's notFound() from requireAdmin isn't swallowed.
  const { db, uid: actorUid } = await requireAdmin();

  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const emailRaw = String(formData.get("email") ?? "");
  const orgAdmin = formData.get("org_admin") === "on";

  if (!firstName) return { ok: false, error: "First name is required" };
  if (!lastName) return { ok: false, error: "Last name is required" };
  const teams = readTeams(formData);
  if ("error" in teams) return { ok: false, error: teams.error };

  try {
    const email = assertInviteEmail(emailRaw);
    const auth = getAdminAuth();
    const uid = await ensureAuthUser(auth, { email, firstName, lastName });

    // Profile first: a roster row pointing at a uid with no profile renders
    // as "—". Also clears the tombstone an earlier delete may have left, so
    // re-adding someone brings them back rather than leaving them reading as
    // deactivated.
    await db.collection("users").doc(uid).set(
      {
        display_name: `${firstName} ${lastName}`.trim(),
        first_name: firstName,
        last_name: lastName,
        email,
        deactivated_at: null,
        deactivated_by: null,
        ...stamp(actorUid),
      },
      { merge: true },
    );

    for (const t of teams) {
      const team = await db.collection("teams").doc(t.id).get();
      if (!team.exists) return { ok: false, error: "One of those teams no longer exists" };
    }
    // Additive: "Add person" on an address that already exists must not
    // strip the teams they are already on.
    await applyTeams(db, actorUid, uid, teams, true);
    if (orgAdmin) await setOrgAdmin(db, actorUid, uid, true);

    revalidateOrg();
    const where =
      teams.length === 0
        ? "with no team yet"
        : `on ${teams.length} team${teams.length === 1 ? "" : "s"}`;
    return {
      ok: true,
      message: `${firstName} ${lastName} added ${where}. They can sign in with Google as ${email}.`,
    };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * Save the Edit-person form: the full set of teams they should be on (with
 * leader/member on each) and whether they hold the org-admin claim. Whatever
 * is not in the form is removed — this is the one place an admin states a
 * person's access as a whole rather than nudging it.
 */
export async function updateOrgPerson(
  uid: string,
  formData: FormData,
): Promise<AdminResult> {
  const { db, uid: actorUid } = await requireAdmin();

  if (!uid) return { ok: false, error: "No user given" };
  const orgAdmin = formData.get("org_admin") === "on";
  const teams = readTeams(formData);
  if ("error" in teams) return { ok: false, error: teams.error };

  if (uid === actorUid && !orgAdmin) {
    return {
      ok: false,
      error: "You can't remove your own admin access — another admin has to.",
    };
  }

  try {
    // Someone who signed in uninvited has an account and no profile. Give
    // them one now so their roster rows render a name.
    const profile = await db.collection("users").doc(uid).get();
    if (!profile.exists) {
      const account = await getAdminAuth().getUser(uid).catch(() => null);
      if (!account) return { ok: false, error: "That person no longer exists" };
      await db.collection("users").doc(uid).set(
        {
          display_name: account.displayName ?? account.email ?? uid,
          email: account.email ?? null,
          ...stamp(actorUid),
        },
        { merge: true },
      );
    }

    const changes = await applyTeams(db, actorUid, uid, teams);
    const adminChanged = await setOrgAdmin(db, actorUid, uid, orgAdmin);
    // Feedback tracker access (N73) is keyed by email, like the list itself.
    // null = unchanged; otherwise the new state.
    let feedbackNow: boolean | null = null;
    if (formData.get("feedback_tracker_shown") === "1") {
      const want = formData.get("feedback_tracker") === "on";
      const fresh = await db.collection("users").doc(uid).get();
      const account = await getAdminAuth().getUser(uid).catch(() => null);
      const email = ((fresh.data()?.email as string | undefined) ?? account?.email ?? "").trim();
      if (!email) {
        if (want) return { ok: false, error: "No email on file, so tracker access can't be granted." };
      } else if (await setFeedbackAccess(db, actorUid, email, want)) {
        feedbackNow = want;
        await recordAccessChange(db, {
          kind: "feedback_tracker",
          actorUid,
          entityId: uid,
          targetUid: uid,
          before: { feedback_tracker: !want },
          after: { feedback_tracker: want },
        });
      }
    }

    revalidateOrg();
    const parts: string[] = [];
    if (changes.added) parts.push(`added to ${changes.added}`);
    if (changes.removed) parts.push(`removed from ${changes.removed}`);
    if (changes.reroled) parts.push(`role changed on ${changes.reroled}`);
    if (adminChanged) parts.push(orgAdmin ? "made org admin" : "org admin removed");
    if (feedbackNow !== null) {
      parts.push(feedbackNow ? "feedback tracker access granted" : "feedback tracker access removed");
    }
    return {
      ok: true,
      message: parts.length ? `Saved: ${parts.join(", ")}.` : "No changes.",
    };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * Deactivate a person (spec §2.6, decision D5): DISABLE the sign-in account
 * (reversible - not deleted), revoke sessions, drop roster rows / speaking
 * order / meeting driver, mark `users/{uid}.deactivated_at`, and unassign
 * everything they owned, telling each parent team's leaders. The profile is
 * kept so names on history still render. See lib/firebase/deactivate.ts.
 */
export async function deactivateOrgPerson(uid: string): Promise<DeleteResult> {
  const { db, uid: actorUid } = await requireAdmin();
  try {
    const r = await deactivatePerson(db, getAdminAuth(), uid, actorUid);
    if (!r.ok) return r;
    revalidateOrg();
    const { teamsRemoved, itemsUnassigned, signInDisabled } = r.result;
    return {
      ok: true,
      teamsRemoved,
      signInRevoked: signInDisabled,
      message:
        `Deactivated: removed from ${teamsRemoved} team${teamsRemoved === 1 ? "" : "s"}, ` +
        `${itemsUnassigned} item${itemsUnassigned === 1 ? "" : "s"} unassigned` +
        (signInDisabled ? ", sign-in disabled." : ". There was no sign-in account."),
    };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Undo a deactivation: re-enable sign-in. Items stay unassigned; re-add to teams by hand. */
export async function reactivateOrgPerson(uid: string): Promise<AdminResult> {
  const { db, uid: actorUid } = await requireAdmin();
  try {
    const r = await reactivatePerson(db, getAdminAuth(), uid, actorUid);
    if (!r.ok) return r;
    revalidateOrg();
    return {
      ok: true,
      message: r.signInRestored
        ? "Reactivated. Add them back to their teams and reassign their work."
        : "Reactivated, but there is no sign-in account - invite them again to let them in.",
    };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/** Names that differ only in case or punctuation are the same team here. */
async function nameTaken(
  db: Awaited<ReturnType<typeof requireAdmin>>["db"],
  name: string,
  exceptTeamId?: string,
): Promise<boolean> {
  const key = normalizeKey(name);
  const snap = await db.collection("teams").get();
  return snap.docs.some(
    (d) =>
      d.id !== exceptTeamId && normalizeKey((d.data()?.name as string) ?? "") === key,
  );
}

/**
 * Create a team, optionally with a leader picked from the directory. The seed
 * import produces leaderless teams too, so leaderless is allowed here — the
 * Directory calls those out rather than blocking on it.
 */
export async function createOrgTeam(formData: FormData): Promise<AdminResult> {
  const { db, uid: actorUid } = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const leaderUid = String(formData.get("leader_uid") ?? "").trim();
  if (!name) return { ok: false, error: "Team name is required" };

  try {
    if (await nameTaken(db, name)) {
      return { ok: false, error: `A team named “${name}” already exists.` };
    }
    if (leaderUid) {
      const leader = await db.collection("users").doc(leaderUid).get();
      if (!leader.exists) return { ok: false, error: "That leader no longer exists" };
    }

    const ref = db.collection("teams").doc();
    const batch = db.batch();
    batch.set(ref, {
      name,
      org_id: "default",
      parent_team_id: null,
      meeting_driver_id: null,
      meet_link: null,
      speaking_order: [],
      created_at: FieldValue.serverTimestamp(),
      ...stamp(actorUid),
    });
    if (leaderUid) {
      batch.set(db.collection("team_members").doc(`${ref.id}__${leaderUid}`), {
        team_id: ref.id,
        user_id: leaderUid,
        role: "leader",
        created_at: FieldValue.serverTimestamp(),
        ...stamp(actorUid),
      });
    }
    await batch.commit();
    if (leaderUid) {
      await syncUserTeamIds(db, leaderUid, actorUid);
      await recordAccessChange(db, {
        kind: "roster",
        actorUid,
        entityId: `${ref.id}__${leaderUid}`,
        teamId: ref.id,
        targetUid: leaderUid,
        before: { on_roster: false },
        after: { on_roster: true, role: "leader" },
      });
    }

    revalidateOrg();
    return {
      ok: true,
      message: leaderUid
        ? `“${name}” created with its leader.`
        : `“${name}” created with no leader yet. Edit someone in the Directory to make them its leader.`,
    };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * Rename a team. The seed import matches teams by name, so renaming one to a
 * name the next seed file does not use means that file will create a second
 * team beside it — hence the collision check and nothing more clever.
 */
export async function renameOrgTeam(formData: FormData): Promise<AdminResult> {
  const { db, uid: actorUid } = await requireAdmin();

  const teamId = String(formData.get("team_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!teamId) return { ok: false, error: "No team given" };
  if (!name) return { ok: false, error: "Team name is required" };

  try {
    const ref = db.collection("teams").doc(teamId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: "That team no longer exists" };

    const current = (snap.data()?.name as string) ?? "";
    if (current === name) return { ok: true, message: "Name unchanged." };

    if (await nameTaken(db, name, teamId)) {
      return { ok: false, error: `A team named “${name}” already exists.` };
    }

    await ref.update({ name, ...stamp(actorUid) });
    revalidateOrg();
    return { ok: true, message: `Renamed to “${name}”.` };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
