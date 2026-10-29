"use server";

// Team settings a leader owns: renaming the team. Leader-or-admin via
// requireTeamLeader. Creating teams stays admin-only (app/(app)/admin/actions.ts).

import { revalidatePath } from "next/cache";
import { requireTeamLeader, teamNameTaken } from "@/lib/firebase/teams";
import { stamp } from "@/lib/audit-stamp";
import { requireMaxLength, TITLE_MAX } from "@/lib/text-limits";

type Result = { ok: true; message: string } | { ok: false; error: string };

/**
 * Rename a team in place — same id, so its rocks, to-dos, meetings and roster
 * all follow. Every other surface reads the name off `teams/{id}` at render
 * time, so this one write is the whole rename.
 */
export async function renameTeam(teamId: string, rawName: string): Promise<Result> {
  // Outside try so Next notFound() from requireTeamLeader is not swallowed.
  const { db, team, uid: actorUid } = await requireTeamLeader(teamId);

  const name = String(rawName ?? "").trim();
  if (!name) return { ok: false, error: "Team name is required" };

  try {
    requireMaxLength(name, TITLE_MAX, "Team name");
    if (name === team.name) return { ok: true, message: "Name unchanged." };

    if (await teamNameTaken(db, name, teamId)) {
      return { ok: false, error: `A team named “${name}” already exists.` };
    }

    await db.collection("teams").doc(teamId).update({ name, ...stamp(actorUid) });
    // The name is in the sidebar on every page, not just the Directory.
    revalidatePath("/", "layout");
    return { ok: true, message: `Renamed “${team.name}” to “${name}”.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
