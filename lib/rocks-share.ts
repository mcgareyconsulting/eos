// Cross-team rock share (N4). A rock has one parent `team_id` and optional
// `shared_team_ids`. Guest teams see it at the bottom of their Rocks list
// grouped as "Shared by {First Last}" of the person owner — not the source
// team name (Pass 21).

export type ShareableRock = {
  team_id: string;
  owner_id: string | null;
  shared_team_ids?: string[] | null;
};

export function isSharedIntoTeam(
  rock: ShareableRock,
  teamId: string,
): boolean {
  if (rock.team_id === teamId) return false;
  return (rock.shared_team_ids ?? []).includes(teamId);
}

export function sharedBySectionTitle(ownerName: string): string {
  const name = ownerName.trim() || "Unknown";
  return `Shared by ${name}`;
}

export type SharedRockGroup<T extends ShareableRock> = {
  ownerId: string | null;
  title: string;
  rocks: T[];
};

/** Group shared-in rocks by person owner. Order groups A–Z by the label. */
export function groupSharedRocksByOwner<T extends ShareableRock>(
  rocks: T[],
  ownerName: (id: string | null) => string,
): SharedRockGroup<T>[] {
  const byOwner = new Map<string, T[]>();
  for (const r of rocks) {
    const key = r.owner_id ?? "";
    const list = byOwner.get(key) ?? [];
    list.push(r);
    byOwner.set(key, list);
  }
  const groups: SharedRockGroup<T>[] = [...byOwner.entries()].map(
    ([key, list]) => {
      const ownerId = key === "" ? null : key;
      return {
        ownerId,
        title: sharedBySectionTitle(ownerName(ownerId)),
        rocks: list,
      };
    },
  );
  groups.sort((a, b) => a.title.localeCompare(b.title));
  return groups;
}
