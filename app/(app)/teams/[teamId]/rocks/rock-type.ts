// Shared EOS Rock type constants (company / department / individual). Used by
// server actions, the rock-type badge, and list ordering. Existing rock docs
// predate this field, so a missing/invalid value is always treated as
// "individual" — never write undefined, always normalize on read.
//
// Team-section rocks (top of Rocks list / L10):
//   - owner_id null (legacy shared ownership), OR
//   - rock_type === "department" (UI label: Team) even when a person is accountable.
// Create/edit type is Individual | Team; owner is always a person.

export const ROCK_TYPES = ["company", "department", "individual"] as const;
export type RockType = (typeof ROCK_TYPES)[number];

export const ROCK_TYPE_LABELS: Record<RockType, string> = {
  company: "Company",
  /** Stored as department; create/edit UI says Team. */
  department: "Team",
  individual: "Individual",
};

/** Create/edit chooser — Individual vs Team. Company is treated as Team. */
export const ROCK_KIND_OPTIONS: { value: RockType; label: string }[] = [
  { value: "individual", label: "Individual" },
  { value: "department", label: "Team" },
];

export function toFormRockType(v: string | null | undefined): RockType {
  return normalizeRockType(v) === "individual" ? "individual" : "department";
}

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
 * Form/owner-select sentinel: shared department ownership (owner_id null).
 * Value stays `"team"` so existing form posts / drafts keep working.
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

/** Shared department ownership: no person owner_id. */
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
 * Department-typed rocks land here even when a person is the accountable owner.
 */
export function isDepartmentRock(r: {
  owner_id?: string | null;
  rock_type?: string | null;
}): boolean {
  if (isSharedDepartmentOwner(r.owner_id)) return true;
  return normalizeRockType(r.rock_type) === "department";
}

/** Display label for the shared department owner chip. */
export const DEPARTMENT_SECTION_TITLE = "Department";
