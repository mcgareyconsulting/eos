// Shared EOS Rock type constants (company / department / individual). Used by
// server actions, the rock-type badge, and list ordering. Existing rock docs
// predate this field, so a missing/invalid value is always treated as
// "individual" — never write undefined, always normalize on read.
//
// Team ownership is NOT a rock type — it's owner_id === null (Owner = Team).
// See isTeamRock / TEAM_OWNER_VALUE.

export const ROCK_TYPES = ["company", "department", "individual"] as const;
export type RockType = (typeof ROCK_TYPES)[number];

export const ROCK_TYPE_LABELS: Record<RockType, string> = {
  company: "Company",
  department: "Department",
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

/** Form/owner-select sentinel: assign the rock to the whole team (owner_id null). */
export const TEAM_OWNER_VALUE = "team";

export function isRockType(v: string): v is RockType {
  return (ROCK_TYPES as readonly string[]).includes(v);
}

// Existing rocks predate this field — treat missing/invalid as "individual".
export function normalizeRockType(v: string | null | undefined): RockType {
  return v && isRockType(v) ? v : "individual";
}

// Team Rocks are identified by ownership, not rock_type: no person owner_id.
export function isTeamRock(ownerId: string | null | undefined): boolean {
  return ownerId == null || ownerId === "";
}
