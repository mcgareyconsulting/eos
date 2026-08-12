// Shared EOS Rock type constants (company / department / individual). Used by
// server actions, the rock-type badge, and list ordering. Existing rock docs
// predate this field, so a missing/invalid value is always treated as
// "individual" — never write undefined, always normalize on read.
//
// Department section rocks (top of Rocks list / L10):
//   - rock_type === "department" or "company", OR
//   - legacy: owner_id null (pre-Steph model; treat as department until migrated)
// A department rock still has a **person** owner_id (Steph 2026-08-12).

export const ROCK_TYPES = ["company", "department", "individual"] as const;
export type RockType = (typeof ROCK_TYPES)[number];

export const ROCK_TYPE_LABELS: Record<RockType, string> = {
  company: "Company",
  /** Stored as department; UI says Team (Steph: team rock with a person owner). */
  department: "Team",
  individual: "Individual",
};

export const ROCK_TYPE_STYLES: Record<RockType, string> = {
  company:
    "bg-hpb-blue/10 dark:bg-hpb-blue/20 text-hpb-blue dark:text-white ring-hpb-blue/30",
  department:
    "bg-hpb-gold/15 dark:bg-hpb-gold/20 text-hpb-brown dark:text-hpb-gold ring-hpb-gold/40",
  individual:
    "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 ring-zinc-200 dark:ring-zinc-700",
};

// Sort priority within a section: company, then department, then individual.
export const ROCK_TYPE_ORDER: readonly RockType[] = [
  "company",
  "department",
  "individual",
];

/**
 * @deprecated Legacy form sentinel when owner_id was null for "team" rocks.
 * New creates always use a person owner_id. Kept for reading old form posts.
 */
export const DEPARTMENT_OWNER_VALUE = "team";
/** @deprecated Use DEPARTMENT_OWNER_VALUE */
export const TEAM_OWNER_VALUE = DEPARTMENT_OWNER_VALUE;

export function isRockType(v: string): v is RockType {
  return (ROCK_TYPES as readonly string[]).includes(v);
}

// Existing rocks predate this field — treat missing/invalid as "individual".
export function normalizeRockType(v: string | null | undefined): RockType {
  return v && isRockType(v) ? v : "individual";
}

/** Legacy docs only: no person owner_id (pre person-always model). */
export function isSharedDepartmentOwner(
  ownerId: string | null | undefined,
): boolean {
  return ownerId == null || ownerId === "";
}

/** @deprecated Use isSharedDepartmentOwner */
export function isTeamRock(ownerId: string | null | undefined): boolean {
  return isSharedDepartmentOwner(ownerId);
}

/**
 * Rocks that belong in the Department section at the top of the list / L10.
 * Department/company-typed rocks land here even when a person is the owner.
 * Null owner_id (legacy) still counts as department until data is fixed.
 */
export function isDepartmentRock(r: {
  owner_id?: string | null;
  rock_type?: string | null;
}): boolean {
  if (isSharedDepartmentOwner(r.owner_id)) return true;
  const t = normalizeRockType(r.rock_type);
  return t === "department" || t === "company";
}

/** Display label for the shared department section header. */
export const DEPARTMENT_SECTION_TITLE = "Department";
