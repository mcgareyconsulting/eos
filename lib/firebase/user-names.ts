import { userDisplayName, type UserDocData } from "@/lib/user-name";

// `db.getAll` is capped (~10–30 depending on client), so ids are chunked the
// same way `getOrgDirectory` chunks them.
const CHUNK = 100;

/**
 * Resolve `/users` display names for arbitrary uids.
 *
 * **Exists because team rosters cannot answer this question.** `getTeamMembers`
 * knows one team, so any uid outside it resolves to nothing — which is fine
 * until a feature deliberately shows people from other teams. Cross-team rock
 * shares hit this first (the "Shared by —" bug `lib/user-name.ts` documents),
 * and cross-team measurable shares hit it again in two more places: the
 * org-wide picker, where most owners are outside the viewer's team by
 * definition, and the scorecard grid, where a borrowed row's owner lives on
 * the home team.
 *
 * Prefer the roster where the uid is known to be on the asking team — it is
 * already loaded — and use this for the ones that are not. Missing or
 * profile-less uids are simply absent from the map; callers pick the fallback
 * wording, since "—" and "Unassigned" are right in different places.
 *
 * Admin SDK only (server components / server actions).
 */
export async function loadUserNames(
  db: FirebaseFirestore.Firestore,
  uids: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(uids.filter((id) => id !== ""))];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const docs = await db.getAll(
      ...ids.slice(i, i + CHUNK).map((id) => db.collection("users").doc(id)),
    );
    for (const snap of docs) {
      const name = userDisplayName(snap.data() as UserDocData);
      if (name) names.set(snap.id, name);
    }
  }
  return names;
}
