// Which section a rock renders in, and which kind pills it wears.
//
// Two independent flags describe a rock:
//   - `rock_type === "department"` — a Team rock (stored as department; UI
//     says Team). Any member can set it.
//   - `is_company_rock === true`   — a Company rock. Admin-only.
// A rock may be either, both, or neither ("individual"). They are flags, not
// a hierarchy — but a rock renders in exactly ONE section, chosen down a
// priority ladder: Company > Department > owner. It keeps every pill it
// qualifies for regardless of where it landed.
//
// Legacy: rocks written before `is_company_rock` existed (and CSV imports
// with Level = Company) may carry `rock_type === "company"`. That is NOT
// read as Company — it reads as a Team rock, exactly as it displayed before
// the flag existed. Nothing is migrated; an admin flags those rocks by hand.
// Treating the legacy value as Company would silently promote every one of
// them the moment this code deployed. A legacy null owner_id still means
// shared department ownership.
//
// Kept free of app/ imports so lib/home-board.ts and lib/l10/rock-order.ts
// can share the one rule instead of each carrying a copy.

export type RockBucket = "company" | "department" | "owner";

export type BucketableRock = {
  owner_id?: string | null;
  rock_type?: string | null;
  is_company_rock?: boolean | null;
};

/** Company flag — the admin-set boolean only. */
export function isCompanyRock(r: BucketableRock): boolean {
  return r.is_company_rock === true;
}

/**
 * Team flag. Legacy "company" counts here: before the boolean existed,
 * company and department shared the Department section and rendered as
 * Team, so those rocks keep that pill and placement until an admin flags
 * them.
 */
export function isTeamRock(r: BucketableRock): boolean {
  if (r.owner_id == null || r.owner_id === "") return true;
  return r.rock_type === "department" || r.rock_type === "company";
}

/** Section placement: highest bucket the rock qualifies for. */
export function rockBucket(r: BucketableRock): RockBucket {
  if (isCompanyRock(r)) return "company";
  if (isTeamRock(r)) return "department";
  return "owner";
}
