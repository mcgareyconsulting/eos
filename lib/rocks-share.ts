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
//
// Milestones add a third way in (N65 ruleset, confirmed 2026-09-22):
//
//   - Sharing a rock with a team is always FULL: the whole rock, every
//     milestone, progress. There is no partial team share.
//   - Assigning a milestone to someone gives THAT PERSON the full rock. If
//     they are NOT on the rock's parent team, each of their teams (that
//     doesn't already have it) also gets the rock's title plus only that
//     person's milestones — no progress. A parent-team member's milestones
//     never travel to their other teams: the rule is for assigning outside. It renders
//     under the person's own section: each person's list shows what they
//     carry. `assignmentCarriers` decides this.
//   - A LOCKED milestone (`team_hidden`) is not passed on to the assignee's
//     teams. It hides nothing from anyone with full access.
//   - "Keep on this team" (`team_only` on the rock) locks every milestone on
//     it, including ones added later, and excludes team shares. Assignees
//     still see the whole rock — it limits what travels, not who is on it.
//
// Full access = org admin, the parent team, a team the rock is shared with,
// the rock's owner, or anyone assigned a milestone on it (`hasFullRockView`).
// Rocks carry a denormalised `milestone_owner_ids` so firestore.rules can
// grant the same set client-side (comments, status history, the rock doc).

export type ShareableRock = {
  team_id: string;
  owner_id: string | null;
  shared_team_ids?: string[] | null;
  /** "Keep on this team": every milestone is treated as locked. */
  team_only?: boolean | null;
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

export type MilestoneLike = {
  owner_id: string | null;
  /** Locked: not passed on to the assignee's teams. */
  team_hidden?: boolean | null;
  /** Legacy: milestones saved as private before the lock existed read as
   *  locked. New saves never write "private" on a milestone. */
  visibility?: string | null;
};

export function isMilestoneLocked(m: MilestoneLike): boolean {
  return m.team_hidden === true || m.visibility === "private";
}

/**
 * Does this viewer get the whole rock — every milestone, locked included,
 * and progress? Admin, parent-team member, member of a team it is shared
 * with, the rock's owner, or the assignee of any milestone on it. The
 * owner counts even off the parent team (they left it, or an import set
 * them): they can tick every milestone and move status, so they must be
 * able to see it all.
 */
export function hasFullRockView(
  rock: ShareableRock,
  viewer: RockViewer,
  milestones: readonly MilestoneLike[],
): boolean {
  if (rockAccessFor(rock, viewer) === "edit") return true;
  if ((rock.shared_team_ids ?? []).some((id) => viewer.teamIds.has(id))) {
    return true;
  }
  if (!viewer.uid) return false;
  if (rock.owner_id === viewer.uid) return true;
  return milestones.some((m) => m.owner_id === viewer.uid);
}

/**
 * The assignment view of a rock for team `teamId`: which of its members
 * carry an unlocked milestone on it, and which. Empty when the team already
 * has the rock in full (parent or shared) — full wins.
 *
 * One entry per carrier; the rock renders once under each carrier's
 * section with only that carrier's milestones.
 */
export function assignmentCarriers<M extends MilestoneLike>(
  rock: ShareableRock,
  teamId: string,
  rosterIds: ReadonlySet<string>,
  milestones: readonly M[],
  /** Carriers who are on the rock's parent team — never propagate. */
  parentMemberIds: ReadonlySet<string>,
): Map<string, M[]> {
  const out = new Map<string, M[]>();
  if (rock.team_only === true) return out;
  if (rock.team_id === teamId || isSharedIntoTeam(rock, teamId)) return out;
  for (const m of milestones) {
    if (
      !m.owner_id ||
      !rosterIds.has(m.owner_id) ||
      parentMemberIds.has(m.owner_id) ||
      isMilestoneLocked(m)
    ) {
      continue;
    }
    const list = out.get(m.owner_id) ?? [];
    list.push(m);
    out.set(m.owner_id, list);
  }
  return out;
}

/**
 * `assignmentCarriers` plus the viewer's own milestones, for a page rendered
 * for one viewer (Rocks tab, L10). Your own milestones always sit in your own
 * section — locked ones and Keep-on-this-team rocks included — so an
 * assignee from outside the rock's teams can find and tick them. What only
 * the viewer sees is reported so the page can grey it out:
 *   - `onlyViewerIds`: milestones the team does not see (locked / team_only)
 *   - `viewerOnlyRow`: the viewer's row exists only because of those
 * A parent-team member gets nothing extra — they use the parent's page.
 */
export function carriersForViewer<M extends MilestoneLike & { id: string }>(
  rock: ShareableRock,
  teamId: string,
  rosterIds: ReadonlySet<string>,
  milestones: readonly M[],
  parentMemberIds: ReadonlySet<string>,
  viewerUid: string | null,
): {
  carriers: Map<string, M[]>;
  onlyViewerIds: Set<string>;
  viewerOnlyRow: boolean;
} {
  const carriers = assignmentCarriers(
    rock,
    teamId,
    rosterIds,
    milestones,
    parentMemberIds,
  );
  const onlyViewerIds = new Set<string>();
  let viewerOnlyRow = false;
  if (
    viewerUid &&
    rosterIds.has(viewerUid) &&
    !parentMemberIds.has(viewerUid)
  ) {
    const mine = milestones.filter((m) => m.owner_id === viewerUid);
    const shared = new Set((carriers.get(viewerUid) ?? []).map((m) => m.id));
    if (mine.length > 0) {
      for (const m of mine) if (!shared.has(m.id)) onlyViewerIds.add(m.id);
      viewerOnlyRow = shared.size === 0;
      carriers.set(viewerUid, mine);
    }
  }
  return { carriers, onlyViewerIds, viewerOnlyRow };
}

/**
 * May the viewer tick this milestone? Full access to the rock's own team (or
 * admin) ticks anything; everyone else ticks only their own milestone, or
 * any milestone on a rock they own. Adding, retitling and deleting stays
 * with the parent team (the edit modal's server gate).
 */
export function canTickMilestone(
  rock: ShareableRock,
  m: MilestoneLike,
  viewer: { uid: string | null; fullAccess: boolean },
): boolean {
  if (viewer.fullAccess) return true;
  return (
    !!viewer.uid && (m.owner_id === viewer.uid || rock.owner_id === viewer.uid)
  );
}

export type SharingSnapshot = {
  parentTeamId: string;
  /** "Keep on this team" — nothing travels through assignments. */
  teamOnly?: boolean;
  /** Teams the rock is shared with (full). */
  teams: string[];
  /** Keyed by a key stable across the edit (doc id or draft key). */
  milestones: Record<
    string,
    {
      title: string;
      locked: boolean;
      ownerId: string;
      ownerName: string;
      /** The owner's teams; [] when not known yet. */
      ownerTeamIds: string[];
    }
  >;
};

export type SharingChange =
  /** A team gets the full rock. */
  | { kind: "team-added"; teamId: string }
  /** Someone on none of the rock's full teams now sees the full rock. */
  | { kind: "assignee-added"; ownerId: string; ownerName: string }
  /** A team newly sees a milestone because one of its people carries it. */
  | { kind: "milestone-to-team"; teamId: string; title: string; ownerName: string }
  /** A team lost its full share but still sees its people's milestones. */
  | { kind: "still-sees"; teamId: string; titles: string[] };

function fullTeams(s: SharingSnapshot): Set<string> {
  return new Set([s.parentTeamId, ...s.teams]);
}

/** Milestone keys `teamId` sees through assignments under `s`. */
function assignedKeys(s: SharingSnapshot, teamId: string): Set<string> {
  const out = new Set<string>();
  if (s.teamOnly || fullTeams(s).has(teamId)) return out;
  for (const [key, m] of Object.entries(s.milestones)) {
    if (m.locked || m.ownerTeamIds.includes(s.parentTeamId)) continue;
    if (m.ownerTeamIds.includes(teamId)) out.add(key);
  }
  return out;
}

/**
 * What a save changes about who sees the rock, for the confirmation. Adding
 * a team, handing someone the full rock, or showing a milestone to a new
 * team are widenings; "still-sees" is the one narrowing reported, because an
 * unshared team that keeps seeing part of the rock is a surprise otherwise.
 */
export function sharingChanges(
  before: SharingSnapshot,
  after: SharingSnapshot,
): SharingChange[] {
  const out: SharingChange[] = [];
  const beforeFull = fullTeams(before);
  const afterFull = fullTeams(after);

  for (const id of after.teams) {
    if (!beforeFull.has(id)) out.push({ kind: "team-added", teamId: id });
  }

  const outsideOwners = (s: SharingSnapshot, full: Set<string>) =>
    new Set(
      Object.values(s.milestones)
        .filter((m) => !m.ownerTeamIds.some((t) => full.has(t)))
        .map((m) => m.ownerId),
    );
  const wasOutside = outsideOwners(before, beforeFull);
  const seen = new Set<string>();
  for (const m of Object.values(after.milestones)) {
    if (seen.has(m.ownerId)) continue;
    seen.add(m.ownerId);
    if (m.ownerTeamIds.some((t) => afterFull.has(t))) continue;
    if (wasOutside.has(m.ownerId)) continue;
    out.push({ kind: "assignee-added", ownerId: m.ownerId, ownerName: m.ownerName });
  }

  const candidateTeams = new Set(
    Object.values(after.milestones).flatMap((m) => m.ownerTeamIds),
  );
  for (const teamId of candidateTeams) {
    if (afterFull.has(teamId)) continue;
    const now = assignedKeys(after, teamId);
    if (now.size === 0) continue;
    if (beforeFull.has(teamId)) {
      out.push({
        kind: "still-sees",
        teamId,
        titles: [...now].map((k) => after.milestones[k].title),
      });
      continue;
    }
    const was = assignedKeys(before, teamId);
    for (const key of now) {
      if (was.has(key)) continue;
      const m = after.milestones[key];
      out.push({
        kind: "milestone-to-team",
        teamId,
        title: m.title,
        ownerName: m.ownerName,
      });
    }
  }
  return out;
}
