// Row building for the shared OwnerPicker (components/ui/owner-picker.tsx).
// Kept free of React so the list rules — which people each scope shows, what
// the search matches, where the optional Unassigned row goes — can be tested
// on their own.

export type OwnerPickerMember = { user_id: string; full_name: string };

/** The picker's first tab: one team's own people, labelled with its name. */
export type OwnerPickerTeam = {
  id: string;
  name: string;
  people: OwnerPickerMember[];
};

/** A person on the "Whole org" tab, with every team they're on. */
export type OrgPerson = {
  user_id: string;
  full_name: string;
  team_ids: string[];
};

export type OwnerPickerScope = "team" | "org";

export type OwnerPickerRow = {
  key: string;
  /** The owner id `onChange` receives — "" for the Unassigned row. */
  id: string;
  name: string;
  detail?: string;
  unassigned?: boolean;
};

/** Row key of the Unassigned row; no user id can collide with it. */
export const UNASSIGNED_ROW_KEY = "__unassigned__";

/**
 * Which tab the picker opens on. An owner not on the team is only findable
 * org-wide; no owner, or a team member, opens on the team tab.
 */
export function initialOwnerScope(
  team: OwnerPickerTeam,
  value: string,
): OwnerPickerScope {
  if (!value) return "team";
  return team.people.some((p) => p.user_id === value) ? "team" : "org";
}

/**
 * The rows for one scope and search. Team scope searches names; org scope
 * (A–Z as given) searches a name or any of the person's team names, and
 * shows those teams as the row's detail. Org scope is empty until
 * `orgPeople` loads.
 *
 * `unassignedLabel` (opt-in) puts an Unassigned row first in either scope —
 * it yields "" — kept while the search is empty or matches the label.
 */
export function ownerPickerRows({
  scope,
  query,
  team,
  orgPeople,
  teamNameById,
  unassignedLabel,
}: {
  scope: OwnerPickerScope;
  query: string;
  team: OwnerPickerTeam;
  orgPeople: readonly OrgPerson[] | null;
  teamNameById: ReadonlyMap<string, string>;
  unassignedLabel?: string;
}): OwnerPickerRow[] {
  const q = query.trim().toLowerCase();
  const rows: OwnerPickerRow[] = [];

  if (
    unassignedLabel !== undefined &&
    (!q || unassignedLabel.toLowerCase().includes(q))
  ) {
    rows.push({
      key: UNASSIGNED_ROW_KEY,
      id: "",
      name: unassignedLabel,
      unassigned: true,
    });
  }

  if (scope === "team") {
    for (const p of team.people) {
      if (q && !p.full_name.toLowerCase().includes(q)) continue;
      rows.push({ key: p.user_id, id: p.user_id, name: p.full_name });
    }
    return rows;
  }

  for (const p of orgPeople ?? []) {
    const teams = p.team_ids.map((id) => teamNameById.get(id) ?? "Team");
    if (
      q &&
      !p.full_name.toLowerCase().includes(q) &&
      !teams.some((n) => n.toLowerCase().includes(q))
    ) {
      continue;
    }
    rows.push({
      key: p.user_id,
      id: p.user_id,
      name: p.full_name,
      detail: teams.join(", "),
    });
  }
  return rows;
}
