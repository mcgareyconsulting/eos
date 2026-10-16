// Pieces every team-page export definition reads the same way: the `team`
// param, the team gate, the roster and the `?owner=` filter. Kept here so the
// definitions under lib/export/pages/ stay configuration and cannot drift
// from one another on what "the team's view" means.

import type { Firestore } from "firebase-admin/firestore";
import type { Viewer } from "@/lib/access";
import { userDisplayName, type UserDocData } from "@/lib/user-name";
import type { ExportRefusal } from "../types";

/** A Firestore document id as the pages accept one in a URL. */
export const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function refuse(status: number, message: string): ExportRefusal {
  return { ok: false, status, message };
}

/** `?archived=` as every entity page reads it: `1` or `true`. */
export function archivedParam(raw: string | null): boolean {
  return raw === "1" || raw === "true";
}

/** The `team` param (the page's path segment), validated. */
export function parseTeamParam(sp: URLSearchParams): string | ExportRefusal {
  const teamId = sp.get("team") ?? "";
  return ID_RE.test(teamId) ? teamId : refuse(400, "Missing or invalid team.");
}

/** `?owner=`, length-capped; validated against the roster in `load`, as the page does. */
export function ownerParam(sp: URLSearchParams): string | null {
  const owner = sp.get("owner");
  return owner && owner.length <= 128 ? owner : null;
}

/** The pages' owner-filter resolution: legacy values, then the roster. */
export function resolveOwnerFilter(
  raw: string | null,
  uid: string,
  rosterIds: ReadonlySet<string>,
): string {
  const filterRaw = raw || "all";
  const legacyMapped =
    filterRaw === "self" || filterRaw === "mine"
      ? uid
      : filterRaw === "team" || filterRaw === "others"
        ? "all"
        : filterRaw;
  return rosterIds.has(legacyMapped) ? legacyMapped : "all";
}

export type Member = { user_id: string; full_name: string };

/** The team's roster with names, as getTeamMembers builds it. */
export async function loadRoster(db: Firestore, teamId: string): Promise<Member[]> {
  const snap = await db.collection("team_members").where("team_id", "==", teamId).get();
  const ids = snap.docs
    .map((d) => d.data().user_id as string | undefined)
    .filter((id): id is string => typeof id === "string" && id !== "");
  if (ids.length === 0) return [];
  const users = await db.getAll(...ids.map((id) => db.collection("users").doc(id)));
  const nameById = new Map(
    users.map((u) => [u.id, userDisplayName(u.data() as UserDocData | undefined)]),
  );
  // getTeamMembers' fallback for a profile-less member.
  return ids.map((id) => ({ user_id: id, full_name: nameById.get(id) || "—" }));
}

/**
 * requireTeamAccess for an export: the team doc, or a 404 refusal. A
 * non-member who is not an admin gets the same answer as a team that doesn't
 * exist.
 */
export async function loadTeamOr404(
  db: Firestore,
  teamId: string,
  viewer: Viewer,
): Promise<{ name: string; data: FirebaseFirestore.DocumentData } | ExportRefusal> {
  const snap = await db.collection("teams").doc(teamId).get();
  if (!snap.exists || (!viewer.isAdmin && !viewer.teamIds.has(teamId))) {
    return refuse(404, "Team not found.");
  }
  const data = snap.data() ?? {};
  return { name: (data.name as string) ?? "Team", data };
}

/** The "Owner" provenance line for a resolved owner filter. */
export function ownerFilterLine(
  ownerFilter: string,
  names: ReadonlyMap<string, string>,
): { label: string; value: string } {
  return {
    label: "Owner",
    value: ownerFilter === "all" ? "All owners" : (names.get(ownerFilter) ?? "—"),
  };
}
