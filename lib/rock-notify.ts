// Rock notifications — the pure half (docs/PERMISSIONS_SPEC.md §3.3, §5.3).
// Who is told when a rock's audience, owner or due date changes, or when a
// milestone changes hands. Firestore side: lib/firebase/rock-events.ts.
// Pure: no Firestore, no React.

import type { RockEvent } from "@/lib/item-registry";

function uniq(ids: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id === "string" && id && !out.includes(id)) out.push(id);
  }
  return out;
}

export type AudienceIds = {
  teamIds: readonly string[];
  userIds: readonly string[];
};

/**
 * Who a save newly added to a rock's audience (spec §5.3: "A leader adds you
 * or your team to the audience of a rock"). People and teams already in the
 * audience are not told again. The actor is never told about their own add.
 */
export function audienceAdded(
  before: AudienceIds,
  after: AudienceIds,
  actorId: string,
): { userIds: string[]; teamIds: string[] } {
  return {
    userIds: uniq(after.userIds).filter(
      (id) => !before.userIds.includes(id) && id !== actorId,
    ),
    teamIds: uniq(after.teamIds).filter((id) => !before.teamIds.includes(id)),
  };
}

/**
 * Who hears an assignee change on a rock or a milestone: the new owner gets
 * `assigned`, the previous owner `unassigned` (spec §5.3). Nobody is told
 * about their own action, and an unchanged owner tells nobody.
 */
export function reassignmentRecipients(
  prevOwnerId: string | null | undefined,
  nextOwnerId: string | null | undefined,
  actorId: string,
): { assigned: string[]; unassigned: string[] } {
  const prev = prevOwnerId || null;
  const next = nextOwnerId || null;
  if (prev === next) return { assigned: [], unassigned: [] };
  return {
    assigned: next && next !== actorId ? [next] : [],
    unassigned: prev && prev !== actorId ? [prev] : [],
  };
}

/** The follower events a rock edit fires (spec §5.3: owner, due date). */
export function rockEditEvents(
  before: { owner_id?: string | null; due_date?: string | null },
  after: { owner_id?: string | null; due_date?: string | null },
): RockEvent[] {
  const out: RockEvent[] = [];
  if ((before.owner_id ?? null) !== (after.owner_id ?? null)) {
    out.push("owner_changed");
  }
  if ((before.due_date ?? null) !== (after.due_date ?? null)) {
    out.push("due_date_changed");
  }
  return out;
}
