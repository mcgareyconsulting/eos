export const SEGMENTS = [
  "segue",
  "scorecard",
  "rocks",
  "headlines",
  "todos",
  "ids",
  "conclude",
  "done",
] as const;

export type Segment = (typeof SEGMENTS)[number];

// Standard EOS L10: 5 + 5 + 5 + 5 + 5 + 60 + 5 = 90 minutes.
export const TOTAL_MEETING_SECONDS = 90 * 60;

export const SEGMENT_DURATION_SECONDS: Record<Segment, number> = {
  segue: 5 * 60,
  scorecard: 5 * 60,
  rocks: 5 * 60,
  headlines: 5 * 60,
  todos: 5 * 60,
  ids: 60 * 60,
  conclude: 5 * 60,
  done: 0,
};

export const SEGMENT_LABELS: Record<Segment, string> = {
  segue: "Segue",
  scorecard: "Scorecard",
  rocks: "Rocks",
  headlines: "Headlines",
  todos: "To-Dos",
  ids: "IDS",
  conclude: "Conclude",
  done: "Done",
};

export const SEGMENT_HINTS: Record<Segment, string> = {
  segue: "Personal + professional good news. 30-60 sec per person, no discussion.",
  scorecard: "Off-track metrics? Drop them to the Issues list.",
  rocks: "Quick on-track / off-track per rock. Off-track → Issues.",
  headlines: "Customer wins, customer losses, employee news. Headlines, not discussions.",
  todos: "Check off prior week's to-dos. Anything not done after 1 week → Issues.",
  ids: "Identify the real issue, Discuss it, Solve it. Solve creates a 7-day to-do.",
  conclude: "Recap new to-dos, identify cascading messages, rate the meeting 1-10.",
  done: "Meeting complete.",
};

export function nextSegment(s: Segment): Segment {
  const i = SEGMENTS.indexOf(s);
  return SEGMENTS[Math.min(i + 1, SEGMENTS.length - 1)];
}

export function prevSegment(s: Segment): Segment {
  const i = SEGMENTS.indexOf(s);
  return SEGMENTS[Math.max(i - 1, 0)];
}

export function isActiveSegment(s: Segment): boolean {
  return s !== "done";
}
