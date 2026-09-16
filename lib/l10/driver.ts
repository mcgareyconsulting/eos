// Who drives the live L10.
//
// The room's model:
//
//   driver    — whoever hit Start. Stored on the MEETING (`driver_id`), not on
//               the team: driving is something you are doing right now, not a
//               rank you hold. Only the driver moves the group's stage or ends
//               the meeting.
//   takeover  — anyone on the team may take the wheel, with one confirm. It is
//               visible (the pill renames itself on every screen through the
//               meeting-doc snapshot) and it is never blocked, so a driver who
//               closes their laptop mid-Issues cannot strand the room.
//   unclaimed — a meeting with no `driver_id` (every meeting started before
//               this shipped). Anyone may drive it, and the first transport
//               action claims the wheel. No backfill needed.
//
// This replaces leader-only transport (QW1 #9). "Leader" was the wrong axis:
// the person facilitating is whoever is facilitating, and gating on a team
// role meant a room whose leader was absent could not be started, advanced or
// finished by the seven people sitting in it.

/** A meeting nobody has claimed — legacy docs from before `driver_id`. */
export function isUnclaimed(driverId: string | null | undefined): boolean {
  return !driverId;
}

/**
 * Whether this viewer may move the group: advance/rewind the stage, or Finish.
 *
 * Org admins keep the bypass they have everywhere else (support access), and
 * an unclaimed meeting is open to any member of the team — the caller has
 * already proven membership by getting this far.
 */
export function canDrive(opts: {
  driverId: string | null | undefined;
  uid: string;
  isAdmin: boolean;
}): boolean {
  if (opts.isAdmin) return true;
  if (isUnclaimed(opts.driverId)) return true;
  return opts.driverId === opts.uid;
}

export const NOT_DRIVING_MESSAGE =
  "Someone else is driving this meeting. Take the wheel to move the group.";

/**
 * Whether the rail should offer "Take the wheel".
 *
 * Not simply `!canDrive`: an unclaimed meeting is drivable by everyone, so
 * showing a takeover button there would be offering someone something they
 * already have. The transport buttons show instead, and driving claims it.
 */
export function shouldOfferTakeover(opts: {
  driverId: string | null | undefined;
  uid: string;
  isAdmin: boolean;
  ended: boolean;
}): boolean {
  if (opts.ended) return false;
  if (isUnclaimed(opts.driverId)) return false;
  if (opts.driverId === opts.uid) return false;
  // Admins *may* drive without taking the wheel, but the room should still see
  // who is holding it — an admin who wants control takes it like anyone else.
  return true;
}

// How long a live meeting may sit untouched before Start treats it as
// abandoned rather than as today's room. An L10 is an hour; a team that ran
// long, or came back after lunch, must still land in the same meeting. A
// meeting from last Tuesday must not become this Tuesday's.
export const STALE_MEETING_MS = 12 * 60 * 60 * 1000;

/**
 * Whether an un-ended meeting is a leftover rather than a room to join.
 *
 * `startMeeting` joins any meeting with `ended_at == null` so that two people
 * clicking Start at 9:00 land together. Without a bound, a meeting nobody
 * Finished is joined forever: last week's votes, last week's agenda snapshot,
 * last week's speaking order, and the fresh-meeting vote reset never runs
 * because the join path redirects before it.
 *
 * Measured from the last sign of life (`segment_started_at`, which every
 * advance rewrites) rather than from `started_at`, so a long meeting is never
 * reaped out from under the people still in it.
 */
export function isStaleLiveMeeting(opts: {
  /** `segment_started_at`, or `started_at` for a meeting that never advanced. */
  lastActivityMs: number | null;
  nowMs: number;
}): boolean {
  // No timestamps at all (hand-seeded or half-written doc): treat it as stale
  // rather than joining a room with no known age.
  if (opts.lastActivityMs === null) return true;
  return opts.nowMs - opts.lastActivityMs > STALE_MEETING_MS;
}
