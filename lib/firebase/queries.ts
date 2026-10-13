// Server-page read helpers.
//
// Each function here is *only* the fetch — plus the chunking and dedupe that
// the fetch itself requires. No page-specific filtering (archived rows,
// private to-dos, status) and no display-name derivation lives here: those
// differ per surface, so they stay at the call site where they can be read
// next to the markup they feed. `db` is passed in explicitly (as
// requireTeamDoc does) so these stay testable against a fake Firestore.

import type {
  DocumentData,
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { chunkForInQuery } from "@/lib/firestore-in";

/**
 * Fetch `${collection}/${id}` for each id via one `getAll`.
 *
 * Returns stored data for the docs that exist, keyed by id, in the order the
 * ids were first seen — callers that build an ordered list off the result get
 * the same order they asked for. Missing docs are simply absent, so callers
 * keep choosing their own fallback for an unresolved id.
 */
async function loadDocsById(
  db: Firestore,
  collection: string,
  ids: readonly string[],
): Promise<Map<string, DocumentData>> {
  // Duplicate ids would fetch the same doc twice, and an empty id is not a
  // document path at all — drop both before touching Firestore.
  const unique = [...new Set(ids.filter(Boolean))];
  const byId = new Map<string, DocumentData>();
  if (unique.length === 0) return byId;

  const snaps = await db.getAll(
    ...unique.map((id) => db.collection(collection).doc(id)),
  );
  for (const snap of snaps) {
    if (!snap.exists) continue;
    byId.set(snap.id, snap.data() ?? {});
  }
  return byId;
}

/**
 * `/users/{uid}` docs by id. Callers derive the label themselves — via
 * userDisplayName()/ownerLabel() in lib/user-name.ts, whose fallbacks differ
 * per surface ("You", a team name, "No Owner", "—").
 */
export function loadUsersById(
  db: Firestore,
  ids: readonly string[],
): Promise<Map<string, DocumentData>> {
  return loadDocsById(db, "users", ids);
}

/** `/teams/{id}` docs by id, for naming a team a page didn't already load. */
export function loadTeamsById(
  db: Firestore,
  ids: readonly string[],
): Promise<Map<string, DocumentData>> {
  return loadDocsById(db, "teams", ids);
}

export type TeamRocks = {
  /** Rocks whose `team_id` is this team. */
  own: QueryDocumentSnapshot[];
  /** Rocks owned elsewhere with this team in their audience, never also in `own`. */
  shared: QueryDocumentSnapshot[];
};

/**
 * Both halves of a team's rock list: the team's own rocks and the ones with
 * this team in their audience. A rock can satisfy both queries (the parent
 * listed in its own audience), so `shared` excludes anything already in
 * `own` — otherwise the surface renders it twice.
 *
 * The audience is read from `audience_team_ids` and, until the P13
 * migration, the legacy `shared_team_ids`. Callers keep only rocks whose
 * EFFECTIVE audience has the team (lib/access/rock.ts `isAudienceTeam`): a
 * saved rock's new field wins over a stale old one, and a private rock has
 * no audience.
 *
 * Neither list is filtered by status or archive state: pages disagree on that
 * (the Rocks page has an Archived tab, the L10 segment doesn't).
 */
export async function loadTeamRocks(
  db: Firestore,
  teamId: string,
): Promise<TeamRocks> {
  const [ownSnap, audienceSnap, legacySnap] = await Promise.all([
    db.collection("rocks").where("team_id", "==", teamId).get(),
    db
      .collection("rocks")
      .where("audience_team_ids", "array-contains", teamId)
      .get(),
    db
      .collection("rocks")
      .where("shared_team_ids", "array-contains", teamId)
      .get(),
  ]);
  const seen = new Set(ownSnap.docs.map((d) => d.id));
  const shared: QueryDocumentSnapshot[] = [];
  for (const d of [...audienceSnap.docs, ...legacySnap.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    shared.push(d);
  }
  return { own: ownSnap.docs, shared };
}

/**
 * Milestone to-dos (`todos.source_rock_id in <ids>`) for a set of rocks,
 * chunked for Firestore's `in` cap and flattened in chunk order. Returns
 * every matching row — visibility and completion filtering belong to the
 * caller. An empty id list issues no query.
 */
export async function loadMilestonesForRocks(
  db: Firestore,
  rockIds: readonly string[],
): Promise<QueryDocumentSnapshot[]> {
  const chunks = chunkForInQuery(rockIds);
  if (chunks.length === 0) return [];

  const snaps = await Promise.all(
    chunks.map((ids) =>
      db.collection("todos").where("source_rock_id", "in", ids).get(),
    ),
  );
  return snaps.flatMap((s) => s.docs);
}

/**
 * Rocks that reach a team's blocks (lib/rocks-share.ts `blockMilestones`):
 * rocks outside `excludeRockIds` (the team's own rocks) on which someone on
 * `rosterIds` owns a milestone. Returns the active rocks and the roster's
 * milestones on them — never anyone else's, since a block shows only its
 * member's milestones (spec §4). The caller drops private rocks. Audience
 * rocks are NOT excluded: a rock may show in "Shared by" and in a block.
 *
 * One `owner_id in` query per 30 roster ids; milestones are filtered from
 * the owners' to-dos in memory rather than with a second inequality that
 * would need a new composite index.
 */
export async function loadAssignedRocks(
  db: Firestore,
  rosterIds: readonly string[],
  excludeRockIds: ReadonlySet<string>,
): Promise<{
  rocks: DocumentSnapshot[];
  milestones: QueryDocumentSnapshot[];
}> {
  const snaps = await Promise.all(
    chunkForInQuery(rosterIds).map((ids) =>
      db.collection("todos").where("owner_id", "in", ids).get(),
    ),
  );
  const rockIds = new Set<string>();
  const milestones: QueryDocumentSnapshot[] = [];
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const x = d.data();
      const rid = x.source_rock_id as string | null | undefined;
      if (rid && x.archived_at == null && !excludeRockIds.has(rid)) {
        rockIds.add(rid);
        milestones.push(d);
      }
    }
  }
  if (rockIds.size === 0) return { rocks: [], milestones: [] };
  const rocks = (
    await db.getAll(...[...rockIds].map((id) => db.collection("rocks").doc(id)))
  ).filter((d) => d.exists && d.data()?.archived_at == null);
  const live = new Set(rocks.map((d) => d.id));
  return {
    rocks,
    milestones: milestones.filter((d) =>
      live.has(d.data().source_rock_id as string),
    ),
  };
}
