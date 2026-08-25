// The L10 speaking order — who shares good news in Segue, and who reports in
// the round-robin stages after it.
//
// The durable order lives on the TEAM (`teams/{id}.speaking_order`) so a team
// keeps its rotation week to week. Each meeting takes a copy
// (`meetings/{id}.speaking_order`) plus a live pointer
// (`meetings/{id}.speaking_index`), because:
//   1. the meeting doc is readable by any team member (firestore.rules), while
//      the team doc additionally requires the hosted-domain gate — the meeting
//      copy is what streams to every client, and
//   2. a finished meeting should record the order it actually used rather than
//      be rewritten later by roster churn.
//
// The roster changes underneath a long-lived stored order, so every read goes
// through reconcileSpeakingOrder() rather than trusting the stored array.

export type OrderedMember = { user_id: string; full_name: string };

// Merges a stored order against the current roster:
//   - members still on the team keep their stored position (and relative order)
//   - members missing from the stored order are appended, alphabetically
//   - uids that are no longer members are dropped
//   - duplicate uids in the stored order collapse to their first occurrence
// An empty/absent stored order therefore yields the alphabetical roster, which
// is what meetings created before this feature existed fall back to — no
// backfill migration needed.
export function reconcileSpeakingOrder(
  stored: string[] | null | undefined,
  members: OrderedMember[],
): string[] {
  const memberIds = new Set(members.map((m) => m.user_id));
  const placed = new Set<string>();
  const kept: string[] = [];

  for (const uid of stored ?? []) {
    if (memberIds.has(uid) && !placed.has(uid)) {
      placed.add(uid);
      kept.push(uid);
    }
  }

  const appended = members
    .filter((m) => !placed.has(m.user_id))
    .slice()
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((m) => m.user_id);

  return [...kept, ...appended];
}

// Keeps the live pointer inside the order even after the roster shrinks
// mid-meeting. An empty order pins to 0 so callers can index defensively.
export function clampSpeakerIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || length <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), length - 1);
}

// Steps the pointer, skipping anyone marked absent for this meeting — the
// whole reason attendance is set during Segue rather than at Conclude.
//
// The round is a CYCLE, on every stage including Segue. Past the last person
// present the pointer lands back on the first, and Prev mirrors it backwards.
// Client ask (Ryan, 8/19 L10): "you get to the last speaker, you click next,
// and it goes back to the beginning ... sometimes we go multiple rounds, and
// that's much easier than clicking previous a bunch of times." daniel's call
// on scope: one behaviour across the board, no per-stage exception — Segue
// still shows its round-done marker, it just no longer dead-ends.
//
// This replaces the old inert-at-the-ends contract deliberately. A round with
// nobody else present still returns `from` unchanged, so the control can never
// land on someone who is not in the room.
export function stepSpeakerIndex(
  order: string[],
  index: number,
  absentUserIds: string[],
  direction: 1 | -1,
): number {
  if (order.length === 0) return 0;
  const absent = new Set(absentUserIds);
  const from = clampSpeakerIndex(index, order.length);
  const n = order.length;

  // At most one full lap: if nobody else is present we land back on `from`.
  for (let step = 1; step <= n; step++) {
    const i = (((from + direction * step) % n) + n) % n;
    if (!absent.has(order[i])) return i;
  }
  return from;
}

// The index the pointer should rest on when a round starts: the first person
// who is actually present. Used when seeding a meeting and when each segment
// resets the round.
export function firstPresentIndex(
  order: string[],
  absentUserIds: string[],
): number {
  const absent = new Set(absentUserIds);
  const i = order.findIndex((uid) => !absent.has(uid));
  return i === -1 ? 0 : i;
}

// The rotation as displayed: anyone marked absent is dropped entirely rather
// than shown struck through, so the round reads as the list of people who will
// actually speak. `speaking_index` still indexes the FULL order (that stays the
// stored source of truth) — use currentSpeakerUid() to bridge the two.
export function presentOrder(
  order: string[],
  absentUserIds: string[],
): string[] {
  const absent = new Set(absentUserIds);
  return order.filter((uid) => !absent.has(uid));
}

/**
 * Owner sections for L10 lists (Rocks, etc.): present members first in
 * speaking order, then absentees (still in speaking order, dimmed).
 * Keeps an absentee from appearing *above* someone who is in the room —
 * matching the rail's present-first mental model without hiding their rocks.
 */
export function ownersPresentThenAbsent(
  order: string[],
  absentUserIds: string[] | Set<string>,
): string[] {
  const absent =
    absentUserIds instanceof Set
      ? absentUserIds
      : new Set(absentUserIds);
  const present: string[] = [];
  const missing: string[] = [];
  for (const uid of order) {
    if (absent.has(uid)) missing.push(uid);
    else present.push(uid);
  }
  return [...present, ...missing];
}

// Who currently holds the floor. When the stored pointer lands on someone who
// has since been marked absent, the floor passes to the NEXT person present
// (wrapping to the front only if nobody after them remains) — marking speaker
// #4 absent mid-round must not throw the highlight back to person #1.
export function currentSpeakerUid(
  order: string[],
  index: number,
  absentUserIds: string[],
): string | null {
  if (order.length === 0) return null;
  const absent = new Set(absentUserIds);
  const from = clampSpeakerIndex(index, order.length);
  for (let i = 0; i < order.length; i++) {
    const uid = order[(from + i) % order.length];
    if (uid && !absent.has(uid)) return uid;
  }
  return null;
}

/**
 * Sort scorecard (or similar) rows by owner following speaking order, then
 * each owner's configured sort_order / name. Owner-less rows sort last.
 * When absentees are provided, present owners rank first (same as Rocks).
 */
export function compareBySpeakingOrder(
  a: { owner_id: string | null; sort_order: number; name: string },
  b: { owner_id: string | null; sort_order: number; name: string },
  speakingOrder: string[],
  absentUserIds: string[] = [],
): number {
  const sectionOrder = ownersPresentThenAbsent(speakingOrder, absentUserIds);
  const rank = new Map(sectionOrder.map((uid, i) => [uid, i]));
  const rankOf = (ownerId: string | null) => {
    if (ownerId == null) return Number.POSITIVE_INFINITY;
    return rank.get(ownerId) ?? sectionOrder.length + 1;
  };
  const ar = rankOf(a.owner_id);
  const br = rankOf(b.owner_id);
  if (ar !== br) return ar - br;
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}
