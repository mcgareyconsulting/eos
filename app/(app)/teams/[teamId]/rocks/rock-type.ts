// Shared EOS Rock kind constants. Used by server actions, the rock-type
// pills, and list ordering.
//
// Two independent flags describe a rock (see lib/rock-bucket.ts for the
// placement ladder they feed):
//   - rock_type: "individual" | "department"  — the Team axis. Stored as
//     department; UI says Team. Any member sets it via the kind radio.
//   - is_company_rock: boolean                — the Company flag. Admin-only.
// A rock may be Company, Team, both, or neither. A department/team rock
// still has a **person** owner_id.
//
// "company" stays in ROCK_TYPES so legacy docs (written before the boolean
// existed) still parse; it is never written by the app any more and never
// offered in the picker. Always normalize on read, never write undefined.

export {
  isCompanyRock,
  isTeamRock,
  rockBucket,
  type RockBucket,
} from "@/lib/rock-bucket";

const ROCK_TYPES = ["company", "department", "individual"] as const;
export type RockType = (typeof ROCK_TYPES)[number];

export const ROCK_TYPE_LABELS: Record<RockType, string> = {
  company: "Company",
  /** Stored as department; UI says Team. */
  department: "Team",
  individual: "Individual",
};

/** The two kinds offered on create/edit. Company is a separate checkbox. */
export const ROCK_KIND_OPTIONS: { value: RockType; label: string }[] = [
  { value: "individual", label: "Individual" },
  { value: "department", label: "Team" },
];

export const ROCK_TYPE_STYLES: Record<RockType, string> = {
  company:
    "bg-hpb-blue/10 dark:bg-hpb-blue/20 text-hpb-blue dark:text-white ring-hpb-blue/30",
  department:
    "bg-hpb-gold/15 dark:bg-hpb-gold/20 text-hpb-brown dark:text-hpb-gold ring-hpb-gold/40",
  individual:
    "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 ring-zinc-200 dark:ring-zinc-700",
};

export function isRockType(v: string): v is RockType {
  return (ROCK_TYPES as readonly string[]).includes(v);
}

// Existing rocks predate this field — treat missing/invalid as "individual".
export function normalizeRockType(v: string | null | undefined): RockType {
  return v && isRockType(v) ? v : "individual";
}

/**
 * The kind the edit form's radio should start on. Legacy "company" folds to
 * Team here **for the radio only** — the Company flag is carried separately
 * by `isCompanyRock`, so nothing is lost on save the way it was when the
 * fold was applied to the stored value.
 */
export function kindForForm(
  v: string | null | undefined,
): "individual" | "department" {
  return normalizeRockType(v) === "individual" ? "individual" : "department";
}

/** Section titles for the two leading blocks on Rocks / L10. */
export const COMPANY_SECTION_TITLE = "Company";
export const DEPARTMENT_SECTION_TITLE = "Department";
