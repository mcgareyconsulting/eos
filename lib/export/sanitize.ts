// Spreadsheet formula-injection protection (OWASP "CSV Injection").
//
// Every string an export writes into a spreadsheet came, at some point, from
// a person typing into the app: a to-do title, a team name, a display name.
// A cell that begins with `=`, `+`, `-` or `@` is read as a formula by Excel,
// LibreOffice and Google Sheets once the cell is edited or the sheet is
// re-saved as CSV — `=HYPERLINK("https://evil", "click")` in a title would
// arrive in an auditor's workbook as a live link. Tab and carriage return
// lead the same way (they are how a CSV cell smuggles one in).
//
// OWASP's mitigation: prefix such a cell with a single quote, which every
// spreadsheet treats as "this is text" and does not display. Full-width
// lookalikes (＝ ＋ － ＠) are included because some spreadsheets fold them
// to their ASCII forms. Applied by the .xlsx writer to EVERY string cell,
// provenance header included — callers cannot forget it.

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

/** True when a spreadsheet could read `value` as a formula. */
export function startsLikeFormula(value: string): boolean {
  return value.length > 0 && TRIGGERS.has(value[0]);
}

/** `value`, made inert for a spreadsheet cell. Untouched when already safe. */
export function neutralizeFormula(value: string): string {
  return startsLikeFormula(value) ? `'${value}` : value;
}
