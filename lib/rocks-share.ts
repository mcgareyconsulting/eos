// Where a rock renders on a team page, what a member's block carries, and
// what a save changes about who sees it (docs/PERMISSIONS_SPEC.md §3.3, §4).
//
// WHO may see or change a rock is not decided here: that is
// lib/access/rock.ts (`rockAccess`, `rockViewFor`), the single source of
// truth. This file is the team-page half:
//
//   1. WHERE an audience rock sits on a team page. Owner on this roster →
//      the owner's own section, wearing a "from {parent team}" chip. Not on
//      the roster → "Shared by {First Last}" at the bottom.
//      `partitionSharedRocks`, `groupSharedRocksByOwner`.
//   2. BLOCKS. Each member's block on a team page shows every milestone
//      they own on another team's non-private rock: the rock's headline
//      (title, owner, team) and the milestone, read-only. A block grants no
//      access; only the assignee ticks from it. `blockMilestones`.
//   3. The SAVE REVIEW (`sharingChanges`): who newly sees what.

import {
  audienceTeamIdsOf,
  audienceUserIdsOf,
  isAudienceTeam,
  isPrivateRock,
  type RockSubject,
} from "@/lib/access/rock";

export {
  audienceTeamIdsOf,
  audienceUserIdsOf,
  isAudienceTeam,
  isPrivateRock,
};

export type ShareableRock = RockSubject;

/**
 * Split a team's audience rocks by where they render (question 1 above).
 * `ownerOnRoster` merge into that member's own section; `sharedBy` group
 * at the bottom under the owner's name. An ownerless legacy rock has no
 * section to merge into and always lands in `sharedBy`.
 */
export function partitionSharedRocks<T extends { owner_id: string | null }>(
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

export type SharedRockGroup<T> = {
  ownerId: string | null;
  title: string;
  rocks: T[];
};

/** Group shared-in rocks by person owner. Order groups A–Z by the label. */
export function groupSharedRocksByOwner<T extends { owner_id: string | null }>(
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

export type BlockMilestoneLike = { owner_id: string | null };

/**
 * What team `teamId`'s blocks carry from one rock: per member on
 * `rosterIds`, the milestones they own on it (spec §4).
 *
 *   - Nothing from the team's own rocks (they render in full).
 *   - Nothing from a private rock.
 *   - Unassigned milestones show in no block.
 *   - Nothing from a rock in the team's audience: the full rock, with every
 *     milestone, is already on the page, so a block would only repeat it
 *     (Daniel, 2026-10-14 — the spec's "duplicate is permitted" clause is
 *     withdrawn for the team's own pages).
 */
export function blockMilestones<M extends BlockMilestoneLike>(
  rock: RockSubject,
  teamId: string,
  rosterIds: ReadonlySet<string>,
  milestones: readonly M[],
): Map<string, M[]> {
  const out = new Map<string, M[]>();
  if (rock.team_id === teamId || isPrivateRock(rock)) return out;
  if (isAudienceTeam(rock, teamId)) return out;
  for (const m of milestones) {
    if (!m.owner_id || !rosterIds.has(m.owner_id)) continue;
    const list = out.get(m.owner_id) ?? [];
    list.push(m);
    out.set(m.owner_id, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Save review
// ---------------------------------------------------------------------------

export type SharingSnapshot = {
  parentTeamId: string;
  private: boolean;
  /** Audience teams (full rock). */
  audienceTeamIds: string[];
  /** Audience persons (full rock). */
  audienceUserIds: string[];
  /** Keyed by a key stable across the edit (doc id or draft key). */
  milestones: Record<
    string,
    {
      title: string;
      /** null only for a milestone left unassigned by a deactivation. */
      ownerId: string | null;
      ownerName: string;
      /** The owner's teams; [] when not known yet. */
      ownerTeamIds: string[];
    }
  >;
};

export type SharingChange =
  /** A team joins the audience: it sees and edits the whole rock. */
  | { kind: "team-added"; teamId: string }
  /** A person joins the audience: they see and edit the whole rock. */
  | { kind: "person-added"; userId: string }
  /** An assignee outside the full set: sees only these milestones + the title. */
  | {
      kind: "headline-only";
      ownerId: string;
      ownerName: string;
      ownerTeamIds: string[];
      titles: string[];
    }
  /** A milestone newly shows in its owner's block on another team. */
  | { kind: "block-added"; teamId: string; title: string; ownerName: string }
  /** The rock became private: these lose it. */
  | {
      kind: "private-on";
      teamIds: string[];
      userIds: string[];
      blockTeamIds: string[];
    };

function fullTeams(s: SharingSnapshot): Set<string> {
  return new Set([s.parentTeamId, ...(s.private ? [] : s.audienceTeamIds)]);
}

function seesFull(
  s: SharingSnapshot,
  ownerId: string,
  ownerTeamIds: readonly string[],
): boolean {
  const full = fullTeams(s);
  if (ownerTeamIds.some((t) => full.has(t))) return true;
  return !s.private && s.audienceUserIds.includes(ownerId);
}

/** `${teamId}|${key}` for every milestone a block on another team shows. */
function blockEntries(s: SharingSnapshot): Set<string> {
  const out = new Set<string>();
  if (s.private) return out;
  const full = fullTeams(s);
  for (const [key, m] of Object.entries(s.milestones)) {
    if (!m.ownerId) continue;
    for (const t of m.ownerTeamIds) {
      if (full.has(t)) continue;
      out.add(`${t}|${key}`);
    }
  }
  return out;
}

/** Owner → their milestone keys, for owners who see only their milestones. */
function headlineOwners(s: SharingSnapshot): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [key, m] of Object.entries(s.milestones)) {
    if (!m.ownerId || seesFull(s, m.ownerId, m.ownerTeamIds)) continue;
    const list = out.get(m.ownerId) ?? [];
    list.push(key);
    out.set(m.ownerId, list);
  }
  return out;
}

/**
 * What a save changes about who sees the rock, for the review dialog.
 * Widenings only (a new audience team or person, an assignee who will see
 * just their milestone, a milestone reaching a new block), plus turning
 * Private on, which says who loses the rock. Other narrowings save
 * without asking.
 */
export function sharingChanges(
  before: SharingSnapshot,
  after: SharingSnapshot,
): SharingChange[] {
  const out: SharingChange[] = [];

  if (!before.private && after.private) {
    const blockTeams = new Set(
      [...blockEntries(before)].map((e) => e.split("|")[0]),
    );
    if (
      before.audienceTeamIds.length > 0 ||
      before.audienceUserIds.length > 0 ||
      blockTeams.size > 0
    ) {
      out.push({
        kind: "private-on",
        teamIds: [...before.audienceTeamIds],
        userIds: [...before.audienceUserIds],
        blockTeamIds: [...blockTeams],
      });
    }
  }

  if (!after.private) {
    const wasTeams = before.private ? new Set<string>() : new Set(before.audienceTeamIds);
    for (const id of after.audienceTeamIds) {
      if (!wasTeams.has(id)) out.push({ kind: "team-added", teamId: id });
    }
    const wasUsers = before.private ? new Set<string>() : new Set(before.audienceUserIds);
    for (const id of after.audienceUserIds) {
      if (!wasUsers.has(id)) out.push({ kind: "person-added", userId: id });
    }
  }

  const wasHeadline = headlineOwners(before);
  for (const [ownerId, keys] of headlineOwners(after)) {
    const had = new Set(wasHeadline.get(ownerId) ?? []);
    if (keys.every((k) => had.has(k))) continue;
    const first = after.milestones[keys[0]];
    out.push({
      kind: "headline-only",
      ownerId,
      ownerName: first.ownerName,
      ownerTeamIds: first.ownerTeamIds,
      titles: keys.map((k) => after.milestones[k].title),
    });
  }

  const wasBlock = blockEntries(before);
  for (const entry of blockEntries(after)) {
    if (wasBlock.has(entry)) continue;
    const [teamId, key] = entry.split("|");
    const m = after.milestones[key];
    out.push({ kind: "block-added", teamId, title: m.title, ownerName: m.ownerName });
  }
  return out;
}

/**
 * Everything the saved rock shares, as the review dialog lists it: every
 * audience team and person, every assignee who sees only their milestones,
 * every block milestone — not just what this save adds. It is
 * `sharingChanges` from a rock shared with nobody, so the entries read the
 * same; `sharingChangeKey` matches them against the real changes to badge
 * the new ones.
 */
export function sharingPicture(after: SharingSnapshot): SharingChange[] {
  const nobody: SharingSnapshot = {
    parentTeamId: after.parentTeamId,
    private: false,
    audienceTeamIds: [],
    audienceUserIds: [],
    milestones: {},
  };
  return sharingChanges(nobody, after).filter((c) => c.kind !== "private-on");
}

/** Identity of a review entry, so a picture entry can be found among the changes. */
export function sharingChangeKey(c: SharingChange): string {
  switch (c.kind) {
    case "team-added":
      return `team:${c.teamId}`;
    case "person-added":
      return `person:${c.userId}`;
    case "headline-only":
      return `headline:${c.ownerId}`;
    case "block-added":
      return `block:${c.teamId}|${c.title}|${c.ownerName}`;
    case "private-on":
      return "private-on";
  }
}

/**
 * Audience teams and persons a save removes while the rock stays shared.
 * (Turning Private on is reported by `sharingChanges` as "private-on".)
 */
export function audienceRemovals(
  before: SharingSnapshot,
  after: SharingSnapshot,
): { teamIds: string[]; userIds: string[] } {
  if (before.private || after.private) return { teamIds: [], userIds: [] };
  const teams = new Set(after.audienceTeamIds);
  const users = new Set(after.audienceUserIds);
  return {
    teamIds: before.audienceTeamIds.filter((id) => !teams.has(id)),
    userIds: before.audienceUserIds.filter((id) => !users.has(id)),
  };
}
