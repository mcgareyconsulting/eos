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
// Returns the current index unchanged when there is no eligible person in
// that direction, so the control simply goes inert at the ends of the round
// instead of landing on someone who isn't in the room.
export function stepSpeakerIndex(
  order: string[],
  index: number,
  absentUserIds: string[],
  direction: 1 | -1,
): number {
  if (order.length === 0) return 0;
  const absent = new Set(absentUserIds);
  const from = clampSpeakerIndex(index, order.length);

  for (let i = from + direction; i >= 0 && i < order.length; i += direction) {
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
