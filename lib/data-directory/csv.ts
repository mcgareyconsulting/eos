// RFC 4180 CSV writer for the /data export.
//
// The inverse of parseDelimited() in lib/csv-import.ts, and deliberately its
// mirror image: anything this emits must re-parse to the same cells, because
// export → edit in Excel → re-import is a supported round trip (see
// lib/data-directory/registry.ts, which emits EXPECTED_HEADERS columns).
//
// Not mitigated here, on purpose: spreadsheet formula injection. A title that
// starts with "=", "+" or "@" is still written verbatim, so Excel will treat
// it as a formula on open. The usual fix — prefixing a "'" — would survive the
// round trip and re-import as part of the title, which (since the importer
// matches rows by title) would silently duplicate every affected row. Faithful
// values win; the data is internal and the surface is admin/leadership-gated.

/** Fields needing quotes: the delimiter, a quote, a newline, or edge spaces. */
function needsQuoting(value: string): boolean {
  return (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value !== value.trim()
  );
}

function escapeField(value: string): string {
  return needsQuoting(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * `headers` drives both the header line and the column order — a key missing
 * from a row writes an empty cell rather than shifting the row left.
 *
 * CRLF line endings: Excel and the RFC both want them, and parseDelimited()
 * accepts either.
 */
export function toCsv(
  headers: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  const lines = [headers.map(escapeField).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeField(row[h] ?? "")).join(","));
  }
  return lines.join("\r\n");
}

/**
 * Excel reads a UTF-8 CSV as the local codepage unless it sees a BOM, which
 * mangles any non-ASCII name. parseDelimited() strips it back off, so adding
 * it costs the round trip nothing.
 */
export const CSV_BOM = "﻿";
