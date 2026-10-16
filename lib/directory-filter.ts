// The Directory's search and filters (app/(app)/directory/directory-table.tsx).
// Pure, and shared with the Directory export (lib/export/pages/directory.ts) so
// the table and the file can't drift on who matches.

/** Team-filter value for people on no roster. Not a real team id. */
export const NO_TEAM = "__none__";

export type DirectoryFilterable = {
  firstName: string;
  lastName: string;
  email: string | null;
  access: string;
  teams: readonly { id: string; name: string }[];
};

export type DirectoryFilter = {
  query: string;
  /** Empty = no Role filter. */
  access: ReadonlySet<string>;
  /** Empty = no Team filter. May hold NO_TEAM. */
  team: ReadonlySet<string>;
};

/** Both sets are OR within the filter, AND across them; search is a substring. */
export function filterDirectory<P extends DirectoryFilterable>(
  people: readonly P[],
  filter: DirectoryFilter,
): P[] {
  const q = filter.query.trim().toLowerCase();
  const { access, team } = filter;
  return people.filter((p) => {
    if (access.size > 0 && !access.has(p.access)) return false;
    if (team.size > 0) {
      const onOne = p.teams.some((t) => team.has(t.id));
      const noneWanted = team.has(NO_TEAM) && p.teams.length === 0;
      if (!onOne && !noneWanted) return false;
    }
    if (!q) return true;
    return [p.firstName, p.lastName, p.email ?? "", ...p.teams.map((t) => t.name)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}
