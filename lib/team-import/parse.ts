// Byte → table parsers. Turns a CSV/TSV/XLSX upload into the CsvTable shape
// the importers work with, including the multi-sheet cases (rocks+milestones
// workbooks, issues, headlines).

import { parseDelimited, toTable, type CsvTable } from "../csv-import";
import { pickSheet, readXlsx, type XlsxSheet } from "../xlsx";

export function tableFromBytes(
  bytes: Uint8Array | Buffer,
  filename: string,
  prefer: RegExp,
  sheetName?: string,
): CsvTable {
  const name = filename.toLowerCase();
  let rows: string[][];

  if (name.endsWith(".xlsx")) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const sheets = readXlsx(buf);
    const sheet = pickSheet(sheets, sheetName, prefer);
    rows = sheet.rows;
  } else {
    const text = Buffer.isBuffer(bytes)
      ? bytes.toString("utf8")
      : new TextDecoder("utf-8").decode(bytes);
    rows = parseDelimited(text);
  }

  return toTable(rows);
}

/**
 * Ninety exports Rocks and their Milestones as one two-sheet .xlsx. The CLI
 * has always taken both (`--rocks --milestones` on the same path); the Import
 * page used to read only the rocks sheet, so the milestone half was silently
 * dropped. Read both in one pass.
 *
 * A CSV/TSV holds a single table, so it yields rocks only. The milestone sheet
 * must be a *different* sheet than the one chosen for rocks — a lone
 * "Rocks & Milestones" sheet is a rocks table, not two tables.
 */
export function rocksWorkbookFromBytes(
  bytes: Uint8Array | Buffer,
  filename: string,
): { rocks: CsvTable; milestones?: CsvTable; sheets: string[] } {
  if (!filename.toLowerCase().endsWith(".xlsx")) {
    return {
      rocks: tableFromBytes(bytes, filename, preferRegexForKind("rocks")),
      sheets: [],
    };
  }

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const sheets = readXlsx(buf);
  const { rocks, milestones } = pickRockWorkbookSheets(sheets);

  return {
    rocks: toTable(rocks.rows),
    // A header-only milestone sheet is not worth reporting as an input.
    ...(milestones && toTable(milestones.rows).rows.length > 0
      ? { milestones: toTable(milestones.rows) }
      : {}),
    sheets: sheets.map((sh) => sh.name),
  };
}

/**
 * Split a rocks workbook's sheets into the rocks table and, when the export
 * carries one, the milestones table. Pure so the sheet-matching rules are
 * testable without building a zip.
 */
export function pickRockWorkbookSheets(sheets: XlsxSheet[]): {
  rocks: XlsxSheet;
  milestones?: XlsxSheet;
} {
  const isMilestones = (name: string) =>
    preferRegexForKind("milestones").test(name);
  // "Rock Milestones" matches /rock/i too, so keep milestone-named sheets out
  // of the running for the rocks table before picking — otherwise a workbook
  // that names it that way loses both halves.
  const rockCandidates = sheets.filter((sh) => !isMilestones(sh.name));
  const rocks = pickSheet(
    rockCandidates.length > 0 ? rockCandidates : sheets,
    undefined,
    preferRegexForKind("rocks"),
  );
  const milestones = sheets.find(
    (sh) => sh !== rocks && isMilestones(sh.name),
  );
  return milestones ? { rocks, milestones } : { rocks };
}

export function issueTablesFromBytes(
  bytes: Uint8Array | Buffer,
  filename: string,
  sheetName?: string,
): (CsvTable & { sheetName?: string })[] {
  const name = filename.toLowerCase();
  if (!name.endsWith(".xlsx")) {
    return [tableFromBytes(bytes, filename, /issue|short|long/i, sheetName)];
  }

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const sheets = readXlsx(buf);
  if (sheetName) {
    const sheet = pickSheet(sheets, sheetName, /issue|short|long/i);
    return [Object.assign(toTable(sheet.rows), { sheetName: sheet.name })];
  }

  const prefer = /issue|short.?term|long.?term/i;
  const picked = sheets.filter((s) => prefer.test(s.name));
  const use = picked.length > 0 ? picked : sheets;
  return use.map((sheet) =>
    Object.assign(toTable(sheet.rows), { sheetName: sheet.name }),
  );
}

export function headlineTablesFromBytes(
  bytes: Uint8Array | Buffer,
  filename: string,
  sheetName?: string,
): (CsvTable & { sheetName?: string })[] {
  const name = filename.toLowerCase();
  if (!name.endsWith(".xlsx")) {
    return [tableFromBytes(bytes, filename, /headline|cascad/i, sheetName)];
  }

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const sheets = readXlsx(buf);
  if (sheetName) {
    const sheet = pickSheet(sheets, sheetName, /headline|cascad/i);
    return [Object.assign(toTable(sheet.rows), { sheetName: sheet.name })];
  }

  const prefer = /headline|cascad/i;
  const picked = sheets.filter((s) => prefer.test(s.name));
  const use = picked.length > 0 ? picked : sheets;
  return use.map((sheet) =>
    Object.assign(toTable(sheet.rows), { sheetName: sheet.name }),
  );
}

export function preferRegexForKind(kind: "rocks" | "todos" | "issues" | "milestones" | "scorecard"): RegExp {
  switch (kind) {
    case "rocks":
      return /rock/i;
    case "todos":
      return /to-?dos?|task/i;
    case "issues":
      return /issue|short|long/i;
    case "milestones":
      return /milestone/i;
    case "scorecard":
      return /scorecard|measurable|metric/i;
  }
}
