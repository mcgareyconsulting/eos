// The rock modal's main Owner field (R2): who it lists and what it opens on.
// Kept free of React so it can be tested.
//
// The server only accepts a rock owner on the parent team's roster, or the
// owner the rock already has (requireRosterOwner with `keep`, spec §3.3) —
// so the field lists exactly those people and never the whole org.

export type RockOwnerMember = { user_id: string; full_name: string };

/** A stored owner id as a person id: legacy "team" / none → `fallback`. */
export function personOwnerId(
  ownerId: string | null | undefined,
  fallback: string,
): string {
  if (!ownerId || ownerId === "team") return fallback;
  return ownerId;
}

/**
 * The owner the modal opens with: the stored owner, or the current user for
 * a new rock (and a legacy "team" owner). "" — nobody picked yet — when that
 * fallback is someone the server would refuse: an admin working a team they
 * aren't rostered on. The field then reads "Choose owner" instead of naming
 * a person the save would reject.
 */
export function initialRockOwner(
  storedOwnerId: string | null | undefined,
  currentUserId: string,
  rosterIds: ReadonlySet<string>,
): string {
  const id = personOwnerId(storedOwnerId, currentUserId);
  if (id === storedOwnerId || rosterIds.has(id)) return id;
  return "";
}

/**
 * The people the Owner field lists: the parent team's roster, then the
 * rock's stored owner if they have since left the team (saving may keep
 * them), marked as such.
 */
export function rockOwnerChoices(
  members: readonly RockOwnerMember[],
  storedOwnerId: string | null | undefined,
  storedOwnerName: string,
): RockOwnerMember[] {
  const people = [...members];
  if (
    storedOwnerId &&
    storedOwnerId !== "team" &&
    !members.some((m) => m.user_id === storedOwnerId)
  ) {
    people.push({
      user_id: storedOwnerId,
      full_name: `${storedOwnerName} (no longer on this team)`,
    });
  }
  return people;
}
