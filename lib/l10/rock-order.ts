// L10 Rocks segment ordering — Company rocks first, then Department.
//
// The walk has three tiers:
//   1. A leading Company section — rocks flagged Company, regardless of who
//      is accountable for each one.
//   2. A Department section — Team rocks (and legacy shared-ownership rocks)
//      that are not also Company. Neither leading section is tied to the
//      speaking rail — there is no single "now speaking" owner for shared
//      priorities.
//   3. Per-owner sections for the remaining (individual) rocks, walked in
//      the meeting's speaking order — present members first, then absent
//      members (dimmed, never above someone still in the room), then any
//      orphaned owner_ids that fell out of the roster/order entirely.
//
// A rock lands in exactly one section, chosen down the Company > Department
// > owner ladder (lib/rock-bucket.ts); it keeps every pill it qualifies for.
//
// This mirrors the standalone Rocks tab's "Company, then Department, then
// members A–Z" layout (app/(app)/teams/[teamId]/rocks/page.tsx), swapping
// alphabetical for speaking order since the meeting has a rail to walk.
//
// The classifier is injected so these functions stay pure and testable;
// production passes `rockBucket` from lib/rock-bucket.ts.

import { ownersPresentThenAbsent, type OrderedMember } from "./speaking-order";
import type { RockBucket } from "@/lib/rock-bucket";

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
  /**
   * Which tier this section is. "company" / "department" are the leading
   * shared sections (never on the speaking rail); "owner" is a person.
   */
  bucket: RockBucket;
};

export type L10SectionTitles = {
  company: string;
  department: string;
};

/**
 * Builds the L10 Rocks walk: a leading Company section, then a Department
 * section (each only if non-empty), then one section per owner of the
 * remaining (individual) rocks, in speaking order — present owners first,
 * then absent owners (dimmed), then orphaned owner_ids not in the order at
 * all (present orphans before absent orphans, alphabetical within each).
 *
 * "Now speaking" (`isCurrentSpeaker`) only ever lands on an owner section —
 * the shared sections have no single speaker by definition, so they always
 * come first structurally but are never highlighted as the current turn.
 */
export function groupRocksForL10<T extends RockOwner & SortableRock>(
  rocks: T[],
  bucketOf: (rock: T) => RockBucket,
  members: OrderedMember[],
  speakingOrder: string[],
  absentUserIds: Set<string> | string[],
  currentSpeaker: string | null,
  titles: L10SectionTitles,
): L10RockSection<T>[] {
  const absent =
    absentUserIds instanceof Set ? absentUserIds : new Set(absentUserIds);

  const companyRocks: T[] = [];
  const deptRocks: T[] = [];
  const personal: T[] = [];
  for (const r of rocks) {
    const bucket = bucketOf(r);
    if (bucket === "company") companyRocks.push(r);
    else if (bucket === "department") deptRocks.push(r);
    else personal.push(r);
  }

  const sections: L10RockSection<T>[] = [];
  if (companyRocks.length > 0) {
    sections.push({
      key: "company",
      title: titles.company,
      rocks: sortRocksForSection(companyRocks),
      absent: false,
      isCurrentSpeaker: false,
      bucket: "company",
    });
  }
  if (deptRocks.length > 0) {
    sections.push({
      key: "department",
      title: titles.department,
      rocks: sortRocksForSection(deptRocks),
      absent: false,
      isCurrentSpeaker: false,
      bucket: "department",
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
      bucket: "owner",
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
      bucket: "owner",
    });
  }

  return sections;
}
