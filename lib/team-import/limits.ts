// C-10 on the import path: the server actions refuse over-long text with
// `requireMaxLength` (lib/text-limits.ts), but a CSV/xlsx row used to bypass
// that and land a 20,000-char "title" that only errored the first time
// someone edited it. Imports apply the same caps per row: an over-long row
// is skipped with a note in the preview, never written, and the rest of the
// file still imports.

import { LONG_TEXT_MAX, TITLE_MAX } from "../text-limits";

export { LONG_TEXT_MAX, TITLE_MAX };

export type LengthCheck = {
  label: string;
  value: string | null | undefined;
  max: number;
};

/** Preview rows show at most this much of a title. */
const PREVIEW_TITLE_MAX = 120;

/**
 * The skip note for the first field over its cap, or null when every field
 * fits. Wording matches the in-app error so the fix is recognisable.
 */
export function overLengthNote(checks: LengthCheck[]): string | null {
  for (const c of checks) {
    if (c.value && c.value.length > c.max) {
      return `${c.label} too long (${c.value.length} chars, max ${c.max}) — shorten it in the file`;
    }
  }
  return null;
}

/** A title safe to put in a preview row even when it is the thing that's too long. */
export function previewTitle(title: string): string {
  return title.length > PREVIEW_TITLE_MAX
    ? `${title.slice(0, PREVIEW_TITLE_MAX - 1)}…`
    : title;
}
