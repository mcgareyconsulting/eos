"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/firebase/teams";
import {
  assertInviteEmail,
  ensureAuthUser,
  writeMembership,
} from "@/lib/team-invite";

export type CreateTeamResult =
  | { ok: true; teamId: string; teamName: string }
  | { ok: false; error: string };

/**
 * Admin: create a team and pre-provision its first leader in one step.
 * Flow in UI: name → invite leader → Done.
 * Admin is not auto-added to the roster (god-mode access stays claim-based).
 */
export async function createTeamWithLeader(
  formData: FormData,
): Promise<CreateTeamResult> {
  // Outside try so Next notFound() from requireAdmin is not swallowed.
  const { db } = await requireAdmin();

  const teamName = String(formData.get("team_name") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const emailRaw = String(formData.get("email") ?? "");

  if (!teamName) {
    return { ok: false, error: "Team name is required" };
  }
  if (!firstName) {
    return { ok: false, error: "Leader first name is required" };
  }
  if (!lastName) {
    return { ok: false, error: "Leader last name is required" };
  }

  let email: string;
  try {
    email = assertInviteEmail(emailRaw);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const existingName = await db
      .collection("teams")
      .where("name", "==", teamName)
      .limit(1)
      .get();
    if (!existingName.empty) {
      return {
        ok: false,
        error: `A team named “${teamName}” already exists. Choose a different name.`,
      };
    }

    const auth = getAdminAuth();
    const userId = await ensureAuthUser(auth, {
      email,
      firstName,
      lastName,
    });

    const teamRef = db.collection("teams").doc();
    await teamRef.set({
      name: teamName,
      org_id: "default",
      parent_team_id: null,
      meeting_driver_id: null,
      meet_link: null,
      speaking_order: [userId],
      created_at: FieldValue.serverTimestamp(),
    });

    try {
      await writeMembership(db, {
        teamId: teamRef.id,
        userId,
        role: "leader",
        firstName,
        lastName,
        email,
      });
    } catch (err) {
      await teamRef.delete().catch(() => undefined);
      throw err;
    }

    revalidatePath("/home");
    revalidatePath("/directory");
    revalidatePath(`/teams/${teamRef.id}/members`);

    return { ok: true, teamId: teamRef.id, teamName };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
