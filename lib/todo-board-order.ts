// The To-Dos tab's row order (owner cards, then due date). Pure; shared by
// the live board (app/(app)/teams/[teamId]/todos/todos-board.tsx) and the
// admin export of that page (lib/export/pages/todos.ts), so a printed or
// downloaded view lists rows in the order the screen did.

import { OUTSIDE_GROUP_KEY, OUTSIDE_GROUP_TITLE } from "@/lib/todo-lists";

type Member = { user_id: string; full_name: string };

export type OwnerBucket<T> = { key: string; title: string; items: T[] };

/** Earliest due date first; undated rows last. */
export function byDue<T extends { due_date: string | null }>(a: T, b: T) {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

/**
 * One card per owner (same idea as L10). Order = team speaking order, then
 * alphabetical for anyone off the order, then outside assignees, then
 * Unassigned. Both board columns group this way so the two sides line up
 * owner-for-owner. Input order is preserved inside each bucket — sort before
 * calling.
 */
export function groupByOwner<T extends { owner_id: string | null }>(
  items: T[],
  members: Member[],
  speakingOrder: string[],
): OwnerBucket<T>[] {
  const byOwner = new Map<string, T[]>();
  const unassigned: T[] = [];
  const outside: T[] = [];
  const rosterIds = new Set(members.map((m) => m.user_id));

  for (const t of items) {
    if (!t.owner_id) {
      unassigned.push(t);
      continue;
    }
    // A to-do assigned to someone on another team (spec §3.1) stays on
    // this team's list, in one block of its own.
    if (!rosterIds.has(t.owner_id)) {
      outside.push(t);
      continue;
    }
    const list = byOwner.get(t.owner_id) ?? [];
    list.push(t);
    byOwner.set(t.owner_id, list);
  }

  const nameById = new Map(members.map((m) => [m.user_id, m.full_name]));
  const placed = new Set<string>();
  const buckets: OwnerBucket<T>[] = [];

  const pushOwner = (uid: string) => {
    const list = byOwner.get(uid);
    if (!list || list.length === 0) return;
    placed.add(uid);
    buckets.push({ key: uid, title: nameById.get(uid) ?? "—", items: list });
  };

  for (const uid of speakingOrder) pushOwner(uid);

  const orphans = [...byOwner.keys()].filter((id) => !placed.has(id));
  orphans.sort((a, b) =>
    (nameById.get(a) ?? "—").localeCompare(nameById.get(b) ?? "—"),
  );
  for (const uid of orphans) pushOwner(uid);

  if (outside.length > 0) {
    buckets.push({ key: OUTSIDE_GROUP_KEY, title: OUTSIDE_GROUP_TITLE, items: outside });
  }
  if (unassigned.length > 0) {
    buckets.push({ key: "unassigned", title: "Unassigned", items: unassigned });
  }

  return buckets;
}
