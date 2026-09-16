// Cross-team rock share. A rock has one parent `team_id` and optional
// `shared_team_ids`.
//
// Two questions decide every shared-in row on a team's Rocks page / L10:
//
//   1. WHERE does it sit?  By the person owner. On the guest roster → the
//      owner's own section, wearing a "from {parent team}" chip. Not on the
//      roster → at the bottom under "Shared by {First Last}" (the owner's
//      name, never the source team name). `partitionSharedRocks`.
//   2. WHAT may the viewer do?  By the VIEWER, not by the team being viewed
//      — the parent-team rule, `rockAccessFor`. A member of the rock's
//      parent team gets the full rock and every affordance wherever it
//      renders; there is no "guest view" of your own team's rock. This is a
//      line-for-line mirror of the firestore.rules read grant (member of
//      the parent team, or of a team it is shared into), so it can grant
//      nothing the viewer could not fetch by switching teams.

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

/**
 * Split a team's shared-in rocks by where they render (question 1 above).
 * `ownerOnRoster` merge into that member's own section; `sharedBy` group
 * at the bottom under the owner's name. An ownerless legacy rock has no
 * section to merge into and always lands in `sharedBy`.
 */
export function partitionSharedRocks<T extends ShareableRock>(
  rocks: T[],
  rosterIds: ReadonlySet<string>,
): { ownerOnRoster: T[]; sharedBy: T[] } {
  const ownerOnRoster: T[] = [];
  const sharedBy: T[] = [];
  for (const r of rocks) {
    if (r.owner_id && rosterIds.has(r.owner_id)) ownerOnRoster.push(r);
    else sharedBy.push(r);
  }
  return { ownerOnRoster, sharedBy };
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

export type RockViewer = {
  uid: string | null;
  isAdmin: boolean;
  /** Every team the viewer is rostered on (`team_members`), not just the one being viewed. */
  teamIds: ReadonlySet<string>;
};

/**
 * What the viewer may do with a rock, wherever it renders.
 *
 *   "edit"   — org admin, or member of the rock's parent team: the full rock
 *              with every affordance (edit, archive, delete, status,
 *              milestones, re-share). Callers render such a row *as the
 *              parent team* — actions take the parent `team_id`, the modal
 *              gets the parent roster — so the existing server gates apply
 *              unchanged.
 *   "status" — the rock's person owner, on a team it is shared into but not
 *              on its parent team: may move the status from the guest list
 *              or L10 without switching teams; nothing structural.
 *   "read"   — everyone else on a guest team.
 *
 * Only ever hand this a rock the page already loaded for a team the viewer
 * is on (parent or shared-into); it ranks access, it does not decide
 * visibility. The same row looks different to different people in the room
 * — a parent-team member presenting a guest team's L10 sees more than the
 * room does — which is why the "from {team}" chip stays on even at "edit".
 */
export type RockAccess = "edit" | "status" | "read";

export function rockAccessFor(
  rock: ShareableRock,
  viewer: RockViewer,
): RockAccess {
  if (viewer.isAdmin) return "edit";
  if (viewer.teamIds.has(rock.team_id)) return "edit";
  if (!viewer.uid || rock.owner_id !== viewer.uid) return "read";
  const onGuestTeam = (rock.shared_team_ids ?? []).some((id) =>
    viewer.teamIds.has(id),
  );
  return onGuestTeam ? "status" : "read";
}

/**
 * May `uid` move this rock's status while viewing `teamId`?
 *
 * The single-team form of `rockAccessFor`: the viewer's only known
 * membership is the team the action came from. Used by the server status
 * action (the actual gate, since the Admin SDK bypasses firestore.rules) and
 * by rows that were not given the viewer's full membership list, so the two
 * cannot drift apart.
 */
export function canSetRockStatus(
  rock: ShareableRock,
  teamId: string,
  uid: string | null,
): boolean {
  return (
    rockAccessFor(rock, { uid, isAdmin: false, teamIds: new Set([teamId]) }) !==
    "read"
  );
}
