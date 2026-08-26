// Follow-the-leader for the live L10 (N27).
//
// The room's model, decided 2026-08-26 after the 8/12 L10:
//
//   attached (default) — no `?view=`. The group's stage is your stage; when
//                        the leader advances, your content comes with it.
//   detached           — you clicked another stage (`?view=`). The group never
//                        moves you again until you say so.
//   re-attach          — the "Group is on X — Catch up" pill clears `?view=`,
//                        and so does the group catching up to WHERE YOU ARE:
//                        standing on the group's own stage while flagged
//                        detached is a state with no visible difference from
//                        attached, and it only reveals itself by stranding you
//                        one stage later.
//
// This replaces the original contract, which never moved anyone: being pulled
// mid-read was judged jarring. The room's verdict was that hunting for a
// Catch up pill at every stage is worse, and the mid-read worry is answered by
// the opt-out rather than by refusing to follow.

/**
 * Whether an attached viewer should pull the server content over to the
 * group's stage.
 *
 * `lastFollowed` is the stage this client last refreshed for. It exists to
 * make the answer true exactly once per stage change: a refresh takes a moment
 * to re-render, and every snapshot that arrives in the meantime would
 * otherwise queue another one.
 */
export function shouldFollowRefresh(opts: {
  /** No `?view=` — this viewer tracks the group. */
  following: boolean;
  ended: boolean;
  /** The stage the group is on, from the live meeting doc. */
  activeSegment: string;
  /** The stage this client is rendering, from the server. */
  viewSegment: string;
  /** The stage we last refreshed for, or null. */
  lastFollowed: string | null;
}): boolean {
  if (!opts.following || opts.ended) return false;
  // Already showing the group's stage — nothing to pull.
  if (opts.activeSegment === opts.viewSegment) return false;
  // Already asked for this one; the render is in flight.
  if (opts.lastFollowed === opts.activeSegment) return false;
  return true;
}

/**
 * Whether the catch-up affordances should show.
 *
 * Not the same question as "is this screen showing a different stage than the
 * group" — an attached follower is transiently on a different stage while the
 * follow refresh lands, and flashing a Catch up pill at someone who is about
 * to be caught up automatically is noise. The pill means "you stepped away".
 */
export function isDetached(opts: {
  following: boolean;
  activeSegment: string;
  viewSegment: string;
}): boolean {
  return !opts.following && opts.activeSegment !== opts.viewSegment;
}

/**
 * Whether a detached viewer should be silently re-attached.
 *
 * True when the group has arrived at the stage they stepped away to look at.
 * At that instant "detached" is indistinguishable from "attached" — same
 * stage, no pill, nothing to catch up to — so carrying the flag forward only
 * pays out as a surprise when the group moves on and leaves them behind.
 *
 * Clicking the group's current stage in the agenda already re-attaches
 * (`peek()` routes it to `goLive()`); this is the same rule when the group
 * does the moving instead of the viewer.
 *
 * Callers should REPLACE rather than push the `?view=`-less URL: this fires
 * without the viewer asking, and a history entry per re-attach would make the
 * back button walk the meeting backwards.
 */
export function shouldReattach(opts: {
  following: boolean;
  ended: boolean;
  activeSegment: string;
  viewSegment: string;
}): boolean {
  if (opts.following || opts.ended) return false;
  return opts.activeSegment === opts.viewSegment;
}
