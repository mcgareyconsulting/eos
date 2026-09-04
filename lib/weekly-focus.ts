// The weekly-focus flag on a to-do, and the `**` title convention it replaces.
//
// N50 (Jessica): "We currently mark our 'weekly focus' to-do by adding two
// asterisk to the name of the task. Would be nice to have a checkbox for it
// instead." The team invented a text convention to carry state the schema did
// not hold — the same finding shape as N40, where groups were typed into a
// label before they were a thing.
//
// **A free flag, any number** (daniel, 2026-09-02). One-per-person-per-week was
// argued and rejected: `**` is unlimited today, so a field that silently
// unmarked someone's first to-do would be the app overruling a working habit on
// its way to replacing it.
//
// **The week is L10-to-L10, not a calendar week** (daniel, 2026-09-04): "if the
// L10 is Wednesday, Wednesday to Wednesday is the week." Nothing here reads a
// week boundary yet — the flag persists until someone clears it, exactly like
// `**` does today — but that sentence is why this file does not reach for the
// Monday sweep's boundary. They are different weeks and must not be conflated.

/**
 * Leading `**` marker, with or without a trailing space.
 *
 * Both spellings are live in client data (seen 2026-09-04): "** Finish first
 * draft…" and "**Compile list of items…". Anchored to the start because that is
 * where every observed instance sits, and because a `**` mid-title is far more
 * likely to be emphasis than a focus marker.
 */
const FOCUS_MARKER = /^\s*\*\*\s*/;

/** Does this title carry the legacy `**` marker? */
export function hasFocusMarker(title: string | null | undefined): boolean {
  return typeof title === "string" && FOCUS_MARKER.test(title);
}

/**
 * Title with the marker removed. Returns the trimmed original when there is no
 * marker, so this is safe to run over every row in a migration.
 */
export function stripFocusMarker(title: string | null | undefined): string {
  if (typeof title !== "string") return "";
  return title.replace(FOCUS_MARKER, "").trim();
}

/**
 * What a migration should do with one to-do: lift the marker into the field and
 * clean the title. Returns null when there is nothing to change, so the caller
 * writes only the rows that need it.
 *
 * Refuses to strip a title that is *only* a marker — "**" alone would leave an
 * empty title, and `updateTodoMeta` rejects those. Better to flag it and leave
 * the text alone than to write a row the app cannot edit afterwards.
 */
export function migrateFocusMarker(todo: {
  title?: string | null;
  weekly_focus?: boolean | null;
}): { title: string; weekly_focus: true } | null {
  if (!hasFocusMarker(todo.title)) return null;
  const stripped = stripFocusMarker(todo.title);
  if (stripped === "") {
    return todo.weekly_focus === true
      ? null
      : { title: String(todo.title).trim(), weekly_focus: true };
  }
  if (stripped === todo.title && todo.weekly_focus === true) return null;
  return { title: stripped, weekly_focus: true };
}

/** Normalizes whatever is on the doc into a boolean. */
export function isWeeklyFocus(todo: { weekly_focus?: unknown }): boolean {
  return todo.weekly_focus === true;
}
