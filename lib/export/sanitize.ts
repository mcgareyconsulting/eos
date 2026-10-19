// Spreadsheet formula-injection protection (OWASP "CSV Injection").
//
// Every string an export writes came, at some point, from a person typing
// into the app: a to-do title, a team name, a display name. A CSV cell that
// begins with `=`, `+`, `-` or `@` is read as a formula by Excel,
// LibreOffice and Google Sheets when the file is opened —
// `=HYPERLINK("https://evil", "click")` in a title would arrive in an
// auditor's workbook as a live link. Tab and carriage return lead the same
// way (they are how a CSV cell smuggles one in).
//
// OWASP's mitigation: prefix such a cell with a single quote, so the
// spreadsheet reads it as text. Applied by the CSV writer
// (lib/export/csv.ts) to EVERY text cell, headers included — callers cannot
// forget it. Beyond the first character it also checks:
//
//   - after leading whitespace, control characters or zero-width
//     characters (`  =1+1`, NUL or U+200B then `=`): some spreadsheets trim
//     before deciding a cell is a formula;
//   - every line of a multi-line value: a cell whose second line begins
//     with `=` can surface as a formula once someone splits or re-pastes it.
//
// Full-width lookalikes (＝ ＋ － ＠) are included because some spreadsheets
// fold them to their ASCII forms.

const TRIGGERS = new Set([
  "=",
  "+",
  "-",
  "@",
  "\t",
  "\r",
  "\n",
  "＝", // ＝
  "＋", // ＋
  "－", // －
  "＠", // ＠
]);

/**
 * Leading characters a spreadsheet may skip before deciding a cell is a
 * formula: whitespace that is not itself a trigger (tab, CR, LF are), other
 * control characters (NUL and friends), and the invisible zero-width ones.
 */
const LEADING_SPACE =
  /^(?:[^\S\t\r\n]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\u2060\ufeff])+/;

function lineStartsLikeFormula(line: string): boolean {
  if (line.length === 0) return false;
  if (TRIGGERS.has(line[0])) return true;
  const rest = line.replace(LEADING_SPACE, "");
  return rest.length > 0 && TRIGGERS.has(rest[0]);
}

/** True when a spreadsheet could read `value` (or any line of it) as a formula. */
export function startsLikeFormula(value: string): boolean {
  if (value.length === 0) return false;
  if (TRIGGERS.has(value[0])) return true;
  return value.split(/\r\n|\r|\n/).some(lineStartsLikeFormula);
}

/** `value`, made inert for a spreadsheet cell. Untouched when already safe. */
export function neutralizeFormula(value: string): string {
  return startsLikeFormula(value) ? `'${value}` : value;
}
