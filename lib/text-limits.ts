// Length caps for user-entered text (C-10, docs/SECURITY_AUDIT_2026-09-08.md).
//
// Same pattern as the 4000-char comment cap in entity-comments/actions.ts:
// the server action refuses an over-long value with a plain Error the form
// already surfaces. The caps are far above anything typed by hand — they
// exist so a hand-rolled request can't park megabytes in a document (1 MiB is
// Firestore's hard per-document limit) or in every list render.

/** Titles and names: to-dos, issues, headlines, rocks, milestones, measurables, groups. */
export const TITLE_MAX = 500;
/** Long free text: meeting notes and to-do/issue/headline/rock descriptions. */
export const LONG_TEXT_MAX = 20_000;

/**
 * Throw `"<label> too long (max N chars)"` when `value` exceeds `max`.
 * Null/empty passes — "required" is the caller's own check.
 */
export function requireMaxLength(
  value: string | null | undefined,
  max: number,
  label: string,
): void {
  if (value && value.length > max) {
    throw new Error(`${label} too long (max ${max} chars)`);
  }
}
