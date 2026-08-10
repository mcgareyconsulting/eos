// L10 Rocks segment ordering — Pass 18 #17 ("Department rocks first").
//
// The walk has two tiers:
//   1. A single leading Department section — company/department-typed rocks
//      (however they're classified by the caller's `isDepartmentRock`
//      predicate), regardless of who is accountable for each one. This
//      section is never tied to the speaking rail — there's no single
//      "now speaking" owner for shared/department priorities.
//   2. Per-owner sections for the remaining (individual) rocks, walked in
//      the meeting's speaking order — present members first, then absent
//      members (dimmed, never above someone still in the room), then any
//      orphaned owner_ids that fell out of the roster/order entirely.
//
// This mirrors the standalone Rocks tab's "Department section first, then
// members A–Z" layout (app/(app)/teams/[teamId]/rocks/page.tsx), swapping
// alphabetical for speaking order since the meeting has a rail to walk.
//
// Kept dependency-free of the rock-type module (owned by rocks/) by taking
// `isDepartmentRock` as a parameter — these functions stay pure and testable
// without importing app/ code into lib/.

import { ownersPresentThenAbsent, type OrderedMember } from "./speaking-order";

const STATUS_ORDER = ["on_track", "off_track", "done", "cancelled"];

export type SortableRock = {
  status: string;
  quarter?: string | null;
  due_date: string | null;
};

// Within a section: status (on_track, off_track, done, cancelled), then
// quarter (so Q3/Q4 sit together), then due date (undated last).
export function compareRocksForSection(
  a: SortableRock,
  b: SortableRock,
): number {
  const byStatus =
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
  if (byStatus !== 0) return byStatus;
  const qa = a.quarter ?? "";
  const qb = b.quarter ?? "";
  if (qa !== qb) return qa.localeCompare(qb);
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

export function sortRocksForSection<T extends SortableRock>(
  rocks: T[],
): T[] {
  return [...rocks].sort(compareRocksForSection);
}

export type RockOwner = { owner_id: string | null };

export type L10RockSection<T> = {
  key: string;
  title: string;
  rocks: T[];
  absent: boolean;
  isCurrentSpeaker: boolean;
  /** Leading department section — not on the speaking rail. */
  isDepartmentSection: boolean;
};

/**
 * Builds the L10 Rocks walk: one leading Department section (if any
 * department rocks exist), then one section per owner of the remaining
 * (individual) rocks, in speaking order — present owners first, then
 * absent owners (dimmed), then orphaned owner_ids not in the order at all
 * (present orphans before absent orphans, alphabetical within each bucket).
 *
 * "Now speaking" (`isCurrentSpeaker`) only ever lands on an owner section —
 * the Department section has no single speaker by definition, so it always
 * comes first structurally but is never highlighted as the current turn.
 */
export function groupRocksForL10<T extends RockOwner & SortableRock>(
  rocks: T[],
  isDepartmentRock: (rock: T) => boolean,
  members: OrderedMember[],
  speakingOrder: string[],
  absentUserIds: Set<string> | string[],
  currentSpeaker: string | null,
  departmentTitle: string,
): L10RockSection<T>[] {
  const absent =
    absentUserIds instanceof Set ? absentUserIds : new Set(absentUserIds);

  const deptRocks: T[] = [];
  const personal: T[] = [];
  for (const r of rocks) {
    if (isDepartmentRock(r)) deptRocks.push(r);
    else personal.push(r);
  }

  const sections: L10RockSection<T>[] = [];
  if (deptRocks.length > 0) {
    sections.push({
      key: "department",
      title: departmentTitle,
      rocks: sortRocksForSection(deptRocks),
      absent: false,
      isCurrentSpeaker: false,
      isDepartmentSection: true,
    });
  }

  const byOwner = new Map<string, T[]>();
  for (const r of personal) {
    const id = r.owner_id as string;
    const list = byOwner.get(id) ?? [];
    list.push(r);
    byOwner.set(id, list);
  }

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  const placed = new Set<string>();

  // Present first (speaking order), then absentees — never interleave.
  const sectionOrder = ownersPresentThenAbsent(speakingOrder, absent);

  for (const uid of sectionOrder) {
    const list = byOwner.get(uid);
    if (!list || list.length === 0) continue;
    placed.add(uid);
    sections.push({
      key: uid,
      title: nameById.get(uid) ?? "—",
      rocks: sortRocksForSection(list),
      absent: absent.has(uid),
      isCurrentSpeaker: uid === currentSpeaker,
      isDepartmentSection: false,
    });
  }

  // Owners with rocks who aren't in the reconciled order (stale owner_id).
  // Present orphans before absent orphans; alpha within each bucket.
  const orphans = [...byOwner.keys()].filter((id) => !placed.has(id));
  orphans.sort((a, b) => {
    const aAbs = absent.has(a) ? 1 : 0;
    const bAbs = absent.has(b) ? 1 : 0;
    if (aAbs !== bAbs) return aAbs - bAbs;
    return (nameById.get(a) ?? "—").localeCompare(nameById.get(b) ?? "—");
  });
  for (const uid of orphans) {
    const list = byOwner.get(uid)!;
    sections.push({
      key: uid,
      title: nameById.get(uid) ?? "—",
      rocks: sortRocksForSection(list),
      absent: absent.has(uid),
      isCurrentSpeaker: uid === currentSpeaker,
      isDepartmentSection: false,
    });
  }

  return sections;
}
