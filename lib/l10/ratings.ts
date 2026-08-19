// End-of-meeting effectiveness rating lock (N32).
//
// While the meeting is live, an attendee may submit or change their score.
// After conclude, the recap still has to catch people who hadn't rated when
// Finish opened the recap over the form (Pass 18 #16) — so the *first*
// write is allowed. A second write is the integrity hole Joe named: change
// a 10 to a 1 once the room has cleared.

export function ratingWriteAllowed(opts: {
  meetingEnded: boolean;
  alreadyRated: boolean;
}): boolean {
  if (!opts.meetingEnded) return true;
  return !opts.alreadyRated;
}

export const RATING_LOCKED_MESSAGE =
  "This meeting has concluded; ratings can no longer be changed.";
