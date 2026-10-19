// The export file: one CSV (docs/EXPORT.md). Daniel 2026-10-16: CSV only —
// people open it in Excel and print or save as PDF from there.
//
// RFC 4180: comma separator, CRLF between records (and after the last), a
// field quoted when it contains a comma, a double quote, CR or LF, quotes
// inside it doubled. UTF-8 with a leading byte-order mark, so Excel reads
// accented names correctly instead of guessing a Windows code page.
//
// Safety, enforced here so no caller can skip it: every text cell — headers
// included — goes through neutralizeFormula (lib/export/sanitize.ts, OWASP
// CSV injection). Number cells are written as JavaScript prints a finite
// number (`42`, `-3.5`): the core only puts a real number there
// (normalize.ts), and a number can't carry a formula, so a negative value
// stays a number rather than turning into `'-3.5` text.
//
// No header block: provenance lives in the file name and the audit row, so
// the first line is always the column headers and the file sorts and
// filters cleanly.

import { neutralizeFormula } from "./sanitize";
import type { ExportCell } from "./types";

export const CSV_MIME = "text/csv; charset=utf-8";

const BOM = "\uFEFF";
const CRLF = "\r\n";
const NEEDS_QUOTES = /[",\r\n]/;

/** One field: neutralized (text), then quoted when RFC 4180 requires it. */
export function csvField(cell: ExportCell): string {
  const text =
    typeof cell === "number"
      ? Number.isFinite(cell)
        ? String(cell)
        : ""
      : neutralizeFormula(cell);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole file as text, BOM first, a header line, then one line per row. */
export function writeCsv(input: {
  headers: readonly string[];
  rows: readonly (readonly ExportCell[])[];
}): string {
  const lines = [input.headers, ...input.rows].map((r) => r.map(csvField).join(","));
  return BOM + lines.join(CRLF) + CRLF;
}

/** The file as UTF-8 bytes (the BOM becomes EF BB BF). */
export function csvBytes(input: Parameters<typeof writeCsv>[0]): Uint8Array {
  return new TextEncoder().encode(writeCsv(input));
}
