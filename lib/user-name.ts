// Display name for a `/users` doc.
//
// User docs are written with `display_name` / `first_name` / `last_name` /
// `email` (see lib/team-invite.ts, scripts/import-csv.ts, scripts/seed-demo.ts).
// There is NO `full_name` field on the document — `full_name` only exists on
// the in-memory TeamMember shape that getTeamMembers() derives. Reading
// `data.full_name` off a raw snapshot silently yields undefined, which is how
// the N4 "Shared by —" bug happened: shared-rock owners sit on the parent
// team, so they miss the roster lookup and fall through to this path.

export type UserDocData = {
  display_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
};

/** "" when the doc carries no usable name — callers pick their own fallback. */
export function userDisplayName(data: UserDocData | undefined | null): string {
  if (!data) return "";
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return (
    str(data.display_name) ||
    [str(data.first_name), str(data.last_name)].filter(Boolean).join(" ") ||
    str(data.email) ||
    ""
  );
}

/** Shown where a row is deliberately unassigned rather than mis-resolved. */
export const NO_OWNER_LABEL = "No Owner";

/**
 * Label for an entity's owner.
 *
 * A null owner_id is a real state, not missing data: an import can land a row
 * with No Owner (a departed employee's work — see withUnmatchedOwnerNote in
 * lib/team-import.ts), and department rocks carry shared ownership. Rendering
 * that as a bare "—" read as a glitch. An id that no longer matches the roster
 * stays "—", because that one *is* unresolved.
 */
export function ownerLabel(
  id: string | null | undefined,
  nameOf: (id: string) => string | null | undefined,
): string {
  if (!id) return NO_OWNER_LABEL;
  return nameOf(id)?.trim() || "—";
}
