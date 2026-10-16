// The Rocks page's list rules (app/(app)/teams/[teamId]/rocks/page.tsx):
// how a stored rock is read, how a section sorts, and which section a rock
// lands in. Pure, and shared with the admin export (lib/export/pages/rocks.ts)
// so the page and the file can't drift on order or placement.

import {
  audienceTeamIdsOf,
  audienceUserIdsOf,
  isPrivateRock,
  rockSubjectOf,
} from "@/lib/access/rock";
import {
  COMPANY_SECTION_TITLE,
  DEPARTMENT_SECTION_TITLE,
  rockBucket,
} from "@/app/(app)/teams/[teamId]/rocks/rock-type";

const STATUS_ORDER = ["on_track", "off_track", "done", "cancelled"];

/**
 * Timestamp | millis | null → millis | null. Unknown-but-set still counts
 * as archived (0), matching the != null checks downstream.
 */
export function archivedAtMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const t = v as { toMillis?: () => number };
  return typeof t.toMillis === "function" ? t.toMillis() : 0;
}

/**
 * Within a section: status, then quarter (so Q3 / Q4 sit together), then due.
 * Block entries carry no status and sort after the section's own rocks.
 */
export function sortRocks<
  T extends {
    status: string;
    quarter?: string | null;
    due_date: string | null;
  },
>(rocks: T[]): T[] {
  const rank = (s: string) => {
    const i = STATUS_ORDER.indexOf(s);
    return i < 0 ? STATUS_ORDER.length : i;
  };
  return [...rocks].sort((a, b) => {
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    const qa = a.quarter ?? "";
    const qb = b.quarter ?? "";
    if (qa !== qb) return qa.localeCompare(qb);
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
}

/**
 * Plain fields of a full rock. Audience and Private come out as their
 * EFFECTIVE values (lib/access/rock.ts — legacy `shared_team_ids` /
 * `team_only` folded in), so nothing downstream reads the old names.
 */
export function mapFullRock(id: string, x: FirebaseFirestore.DocumentData) {
  const subject = rockSubjectOf(x);
  return {
    id,
    team_id: subject.team_id,
    title: x.title as string,
    owner_id: subject.owner_id,
    quarter: x.quarter as string,
    due_date: (x.due_date as string | null) ?? null,
    status: x.status as string,
    description: (x.description as string | null) ?? null,
    rock_type: (x.rock_type as string | null) ?? null,
    is_company_rock: x.is_company_rock === true,
    audience_team_ids: audienceTeamIdsOf(subject),
    audience_user_ids: audienceUserIdsOf(subject),
    private: isPrivateRock(subject),
    assigned_by: (x.assigned_by as string | null) ?? null,
    created_by: (x.created_by as string | null) ?? null,
    follower_ids: Array.isArray(x.follower_ids)
      ? (x.follower_ids as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    // archived_at is a Firestore Timestamp — pass millis, the raw class
    // instance can't cross into the client RockRow.
    archived_at: archivedAtMillis(x.archived_at),
  };
}

export type FullRock = ReturnType<typeof mapFullRock>;

/** What section placement reads from a full rock or a block entry. */
export type SectionableRock = {
  team_id: string;
  owner_id: string | null;
  status: string;
  quarter?: string | null;
  due_date: string | null;
  rock_type?: string | null;
  is_company_rock?: boolean | null;
};

export type RockGroup<E> = { key: string; title: string; rocks: E[] };

/**
 * The page's sections. All view: Company first, then Department (shared
 * ownership + Team rocks, even when a person is accountable), then members
 * A–Z, then owners no longer on the roster. A rock lands in exactly one
 * section down that ladder (lib/rock-bucket.ts). L10 matches (see
 * segment-rocks.tsx).
 *
 * An audience rock whose owner sits on this roster, and every block entry,
 * skip the ladder and file under that person. An owner filter is one
 * section: that person's rocks.
 */
export function buildRockSections<E extends SectionableRock>(
  rocks: E[],
  ctx: {
    teamId: string;
    /** "all" or a roster user_id. */
    filter: string;
    members: readonly { user_id: string; full_name: string }[];
    ownerName: (id: string | null) => string;
  },
): RockGroup<E>[] {
  const { teamId, filter, members, ownerName } = ctx;
  const rosterIds = new Set(members.map((m) => m.user_id));
  const bucketOf = (r: E) => (r.team_id === teamId ? rockBucket(r) : "owner");

  if (filter !== "all") {
    const list = rocks.filter((r) => r.owner_id === filter);
    if (list.length === 0) return [];
    return [{ key: filter, title: ownerName(filter), rocks: sortRocks(list) }];
  }

  const companyRocks: E[] = [];
  const deptRocks: E[] = [];
  const byOwner = new Map<string, E[]>();
  for (const r of rocks) {
    const bucket = bucketOf(r);
    if (bucket === "company") {
      companyRocks.push(r);
      continue;
    }
    if (bucket === "department") {
      deptRocks.push(r);
      continue;
    }
    const id = r.owner_id as string;
    const list = byOwner.get(id) ?? [];
    list.push(r);
    byOwner.set(id, list);
  }

  const groups: RockGroup<E>[] = [];
  if (companyRocks.length > 0) {
    groups.push({ key: "company", title: COMPANY_SECTION_TITLE, rocks: sortRocks(companyRocks) });
  }
  if (deptRocks.length > 0) {
    groups.push({
      key: "department",
      title: DEPARTMENT_SECTION_TITLE,
      rocks: sortRocks(deptRocks),
    });
  }

  const named = [...members].sort((a, b) => a.full_name.localeCompare(b.full_name));
  for (const m of named) {
    const list = byOwner.get(m.user_id);
    if (!list || list.length === 0) continue;
    groups.push({ key: m.user_id, title: m.full_name, rocks: sortRocks(list) });
  }

  // Owners not on the current roster (left the team, stale id).
  const orphanIds = [...byOwner.keys()].filter((id) => !rosterIds.has(id));
  orphanIds.sort((a, b) => ownerName(a).localeCompare(ownerName(b)));
  for (const id of orphanIds) {
    groups.push({ key: id, title: ownerName(id), rocks: sortRocks(byOwner.get(id)!) });
  }

  return groups;
}
