"use server";

// Leader roster changes on one team: add an existing directory person, remove
// a person. Leader-or-admin via requireTeamLeader. Creating accounts and
// promoting/demoting are admin-only and live in app/(app)/admin/actions.ts.

import { revalidatePath } from "next/cache";
import { requireTeamLeader } from "@/lib/firebase/teams";
import {
  addExistingPersonToTeam,
  removePersonFromTeam,
} from "@/lib/firebase/roster";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function guarded(run: () => Promise<string>): Promise<Result> {
  try {
    const message = await run();
    revalidatePath("/directory");
    return { ok: true, message };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Something went wrong",
    };
  }
}

export async function addTeamMember(
  teamId: string,
  userId: string,
): Promise<Result> {
  const { db, team } = await requireTeamLeader(teamId);
  return guarded(async () => {
    await addExistingPersonToTeam(db, teamId, userId);
    return `Added to ${team.name}.`;
  });
}

export async function removeTeamMember(
  teamId: string,
  userId: string,
): Promise<Result> {
  const { db, team, isAdmin } = await requireTeamLeader(teamId);
  return guarded(async () => {
    await removePersonFromTeam(db, team, userId, isAdmin);
    return `Removed from ${team.name}.`;
  });
}
