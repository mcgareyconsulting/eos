"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/firebase/teams";
import { normalizeKey } from "@/lib/csv-import";
import {
  assertInviteEmail,
  ensureAuthUser,
  writeMembership,
} from "@/lib/team-invite";
import type { AdminResult, DeleteResult } from "./action-types";

function revalidateOrg(teamIds: string[] = []) {
  revalidatePath("/admin/people");
  revalidatePath("/admin/teams");
  revalidatePath("/directory");
  revalidatePath("/home");
  for (const id of teamIds) {
    revalidatePath(`/teams/${id}/members`);
    revalidatePath(`/teams/${id}/members?tab=directory`);
  }
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Add one person org-wide: Auth record + `/users` profile, and a roster row
 * when a team is chosen. Same pre-provision path as the leader-side
 * "Add member" and the seed import, so all three produce identical documents.
 *
 * Nobody is emailed — this is an empty account that activates on the person's
 * first Google sign-in.
 */
export async function addOrgPerson(formData: FormData): Promise<AdminResult> {
  // Outside try so Next's notFound() from requireAdmin isn't swallowed.
  const { db } = await requireAdmin();

  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const emailRaw = String(formData.get("email") ?? "");
  const teamId = String(formData.get("team_id") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "member").trim();
  const title = String(formData.get("title") ?? "").trim();

  if (!firstName) return { ok: false, error: "First name is required" };
  if (!lastName) return { ok: false, error: "Last name is required" };
  if (roleRaw !== "member" && roleRaw !== "leader") {
    return { ok: false, error: "Role must be leader or member" };
  }
  const role = roleRaw;

  try {
    const email = assertInviteEmail(emailRaw);
    const auth = getAdminAuth();
    const userId = await ensureAuthUser(auth, { email, firstName, lastName });

    if (teamId) {
      const team = await db.collection("teams").doc(teamId).get();
      if (!team.exists) return { ok: false, error: "That team no longer exists" };
      // writeMembership writes the profile doc too, and rejects a duplicate
      // roster row.
      await writeMembership(db, {
        teamId,
        userId,
        role,
        firstName,
        lastName,
        email,
      });
    }

    // One profile write covering both paths: the fields writeMembership does
    // not set (title), and the tombstone an earlier delete may have left —
    // re-adding someone who was deleted has to bring them back, not leave
    // them reading as deactivated.
    await db.collection("users").doc(userId).set(
      {
        display_name: `${firstName} ${lastName}`.trim(),
        first_name: firstName,
        last_name: lastName,
        email,
        ...(title ? { title } : {}),
        deactivated_at: null,
        deactivated_by: null,
      },
      { merge: true },
    );

    revalidateOrg(teamId ? [teamId] : []);
    return {
      ok: true,
      message: teamId
        ? `${firstName} ${lastName} added. They can sign in with Google as ${email}.`
        : `${firstName} ${lastName} added with no team yet.`,
    };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * Remove someone's access while keeping the record of their work.
 *
 * Deletes every roster row and the Identity Platform account (so they cannot
 * sign in), and drops them from any speaking order or meeting-driver slot
 * pointing at them. **Keeps the `/users` profile**, marked with
 * `deactivated_at`: every rock, to-do, issue and headline they owned still
 * renders their name instead of turning into an unattributed row. Their
 * owned items are left where they are — reassign them first if someone needs
 * to pick the work up (`pnpm user:reassign`).
 */
export async function deleteOrgPerson(uid: string): Promise<DeleteResult> {
  const { db, uid: actorUid } = await requireAdmin();

  if (!uid) return { ok: false, error: "No user given" };
  if (uid === actorUid) {
    return {
      ok: false,
      error:
        "You can't delete your own account — you would lose admin access with it.",
    };
  }

  try {
    const auth = getAdminAuth();
    const account = await auth.getUser(uid).catch(() => null);

    const memberships = await db
      .collection("team_members")
      .where("user_id", "==", uid)
      .get();
    const teamIds = memberships.docs
      .map((d) => d.data()?.team_id as string)
      .filter(Boolean);

    const batch = db.batch();
    for (const doc of memberships.docs) batch.delete(doc.ref);

    // Clear the uid out of anything on the team that points at it by id.
    const teamDocs = teamIds.length
      ? await db.getAll(...teamIds.map((id) => db.collection("teams").doc(id)))
      : [];
    for (const team of teamDocs) {
      if (!team.exists) continue;
      const data = team.data() ?? {};
      const order = (data.speaking_order as string[]) ?? [];
      const patch: Record<string, unknown> = {};
      if (order.includes(uid)) {
        patch.speaking_order = order.filter((id) => id !== uid);
      }
      if (data.meeting_driver_id === uid) patch.meeting_driver_id = null;
      if (Object.keys(patch).length > 0) batch.update(team.ref, patch);
    }

    // Tombstone the profile rather than deleting it — see the doc comment.
    // Carry the account's email/name over first: for someone who signed in
    // without ever being invited, this is the only place the name survives.
    batch.set(
      db.collection("users").doc(uid),
      {
        ...(account?.email ? { email: account.email } : {}),
        ...(account?.displayName ? { display_name: account.displayName } : {}),
        deactivated_at: FieldValue.serverTimestamp(),
        deactivated_by: actorUid,
      },
      { merge: true },
    );

    await batch.commit();

    let signInRevoked = false;
    if (account) {
      await auth.deleteUser(uid);
      signInRevoked = true;
    }

    revalidateOrg(teamIds);

    return {
      ok: true,
      teamsRemoved: memberships.size,
      signInRevoked,
      message: signInRevoked
        ? `Removed from ${memberships.size} team${memberships.size === 1 ? "" : "s"} and sign-in revoked. Their name still shows on work they owned.`
        : `Removed from ${memberships.size} team${memberships.size === 1 ? "" : "s"}. There was no sign-in account to revoke.`,
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
 * Create an empty team. Distinct from the create-team wizard, which also
 * pre-provisions a leader: the seed import produces leaderless teams too, so
 * the admin console needs to be able to make one the same way and promote
 * someone afterwards on the team's Members tab.
 */
export async function createOrgTeam(formData: FormData): Promise<AdminResult> {
  const { db } = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Team name is required" };

  try {
    if (await nameTaken(db, name)) {
      return { ok: false, error: `A team named “${name}” already exists.` };
    }

    await db.collection("teams").add({
      name,
      org_id: "default",
      parent_team_id: null,
      meeting_driver_id: null,
      meet_link: null,
      speaking_order: [],
      created_at: FieldValue.serverTimestamp(),
    });

    revalidateOrg();
    return {
      ok: true,
      message: `“${name}” created. Add members and promote a leader on its Members tab.`,
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
  const { db } = await requireAdmin();

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

    await ref.update({ name });
    revalidateOrg([teamId]);
    return { ok: true, message: `Renamed to “${name}”.` };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
