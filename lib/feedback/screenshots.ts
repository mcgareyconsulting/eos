// Feedback tracker — the seed's screenshots (docs/feedback/screenshots/*.png).
//
// They are served ONLY through the admin-gated route
// app/api/admin/feedback/screenshots/[name]/route.ts, never from public/:
// they are pictures of the client's data. The route reads a file only when
// its name matches FEEDBACK_SCREENSHOT_RE *and* is in this fixed list — the
// request's text is never joined into a path. lib/feedback/screenshots.test.ts
// checks the list against the directory, so a screenshot added there without
// being listed here (or listed but missing) fails the tests.
//
// Pure: no Node APIs, no React — safe to import from client components.

/** The directory, relative to the project root (and to the standalone server's cwd). */
export const FEEDBACK_SCREENSHOT_DIR = "docs/feedback/screenshots";

/** The only name shape the route accepts. */
export const FEEDBACK_SCREENSHOT_RE = /^row\d{2}\.png$/;

/** Every file in FEEDBACK_SCREENSHOT_DIR. */
export const FEEDBACK_SCREENSHOT_NAMES: readonly string[] = [
  "row02.png",
  "row03.png",
  "row04.png",
  "row05.png",
  "row06.png",
  "row07.png",
  "row12.png",
  "row13.png",
  "row14.png",
  "row18.png",
  "row19.png",
  "row20.png",
  "row31.png",
  "row32.png",
  "row36.png",
  "row37.png",
  "row38.png",
  "row39.png",
];

/**
 * The allow-listed name equal to `name`, or null. Callers use the RETURNED
 * string (a literal from the list), never their input, to build a path.
 */
export function servableFeedbackScreenshot(name: unknown): string | null {
  if (typeof name !== "string" || !FEEDBACK_SCREENSHOT_RE.test(name)) return null;
  return FEEDBACK_SCREENSHOT_NAMES.find((n) => n === name) ?? null;
}

/** Where the detail page loads a screenshot from. */
export function feedbackScreenshotUrl(name: string): string {
  return `/api/admin/feedback/screenshots/${encodeURIComponent(name)}`;
}
