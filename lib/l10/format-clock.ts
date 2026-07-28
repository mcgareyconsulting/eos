// m:ss for every clock in the meeting rail. Sign-aware because the segment
// countdown deliberately runs negative once a segment is over budget — the
// rail shows "-1:20" rather than clamping at zero, so a group can see how far
// past the budget they are.
export function formatClock(seconds: number): string {
  const rounded = Math.trunc(seconds);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const mm = Math.floor(abs / 60);
  const ss = String(abs % 60).padStart(2, "0");
  return `${sign}${mm}:${ss}`;
}
