// Delete a team from the app (admin-only; app/(app)/admin/actions.ts wraps
// this in requireAdmin). The counterpart of createOrgTeam.
//
// What goes: the `teams/{id}` doc and every `team_members` row on it — the
// team's name and its organization. Each former member's `users.team_ids`
// cache is recomputed and the roster removals are logged as access changes,
// so the audit trail still names who was on the team and who dissolved it.
//
// What stays: the team's rocks, to-dos, issues, headlines, metrics and
// meetings. They keep their `team_id` and become unreachable in the app (no
// team page lists them); `pnpm team:delete` is the purge. `teamDataSummary`
// counts and NAMES them so the confirm dialog can list exactly which records
// are being stranded.

import type { Firestore } from "firebase-admin/firestore";
import { stampBeforeDelete } from "@/lib/audit-stamp";
import { recordAccessChanges } from "@/lib/access-audit";
import { syncUsersTeamIds } from "./membership";
import {
  STRANDED_LIST_CAP,
  TEAM_DATA_COLLECTIONS,
  sortStranded,
  strandedRecordOf,
  type TeamDataSummary,
} from "@/lib/team-delete";

// The pure half (types, labels, record naming) lives in lib/team-delete.ts so
// the dialog can import it without dragging firebase-admin into the browser.
export {
  STRANDED_LIST_CAP,
  TEAM_DATA_COLLECTIONS,
  describeLeftBehind,
  sortStranded,
  strandedRecordOf,
  type StrandedRecord,
  type TeamDataSummary,
} from "@/lib/team-delete";

export async function teamDataSummary(
  db: Firestore,
  teamId: string,
): Promise<TeamDataSummary | null> {
  const team = await db.collection("teams").doc(teamId).get();
  if (!team.exists) return null;
  const [members, ...snaps] = await Promise.all([
    db.collection("team_members").where("team_id", "==", teamId).get(),
    ...TEAM_DATA_COLLECTIONS.map(([col]) =>
      db.collection(col).where("team_id", "==", teamId).get(),
    ),
  ]);
  return {
    id: team.id,
    name: (team.data()?.name as string) ?? "Team",
    memberCount: members.docs.length,
    data: TEAM_DATA_COLLECTIONS.map(([collection, label], i) => ({
      collection,
      label,
      count: snaps[i].docs.length,
      records: sortStranded(
        snaps[i].docs.map((d) => strandedRecordOf(collection, d.id, d.data() ?? {})),
      ).slice(0, STRANDED_LIST_CAP),
    })),
  };
}

export type DeleteTeamResult = { name: string; membersRemoved: number };

/**
 * Remove the team doc and its roster. Throws when the team does not exist.
 * The caller has already confirmed with the admin what data stays behind.
 */
export async function deleteTeamCore(
  db: Firestore,
  teamId: string,
  actorUid: string,
): Promise<DeleteTeamResult> {
  const teamRef = db.collection("teams").doc(teamId);
  const team = await teamRef.get();
  if (!team.exists) throw new Error("That team no longer exists");
  const name = (team.data()?.name as string) ?? "Team";

  const members = await db
    .collection("team_members")
    .where("team_id", "==", teamId)
    .get();
  const uids = members.docs
    .map((d) => d.data()?.user_id as string)
    .filter(Boolean);

  // Stamp first so the delete's `before` snapshot carries the actor
  // (lib/audit-stamp.ts), then one batch for the roster and the team.
  await stampBeforeDelete([...members.docs.map((d) => d.ref), teamRef], actorUid);
  const batch = db.batch();
  for (const d of members.docs) batch.delete(d.ref);
  batch.delete(teamRef);
  await batch.commit();

  await syncUsersTeamIds(db, uids, actorUid);
  await recordAccessChanges(db, [
    ...members.docs.map((d) => ({
      kind: "roster" as const,
      actorUid,
      entityId: d.id,
      teamId,
      targetUid: (d.data()?.user_id as string) ?? null,
      before: { on_roster: true, role: (d.data()?.role as string) ?? "member" },
      after: { on_roster: false, team_deleted: true },
    })),
    {
      kind: "team_deleted" as const,
      actorUid,
      entityId: teamId,
      teamId,
      before: { name, members: uids.length },
      after: null,
    },
  ]);

  return { name, membersRemoved: members.docs.length };
}
