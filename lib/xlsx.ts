// Minimal .xlsx reader — enough to turn a workbook into the same
// `string[][]` shape `parseDelimited()` produces, so the CSV importer can take
// either. Dependency-free: an .xlsx is a ZIP of XML, and Node ships both an
// inflate (`node:zlib`) and everything else needed.
//
// Exists because ninety.io exports Rocks and Milestones as a single two-sheet
// workbook, not as CSV. Scope is deliberately narrow — read cell values from
// sheets written by a generator, not render a spreadsheet. Notably: no
// formulas (cached values are used), no merged-cell expansion, no zip64.

import { inflateRawSync } from "node:zlib";

// Generous ceiling for one workbook part (sheet XML / shared strings): far
// above any real ninety.io export, far below anything that hurts the runtime.
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

type ZipEntry = { name: string; offset: number; method: number; size: number };

// Walks the central directory rather than scanning for local headers — the
// central directory is the authoritative index and avoids false positives on
// signature bytes inside compressed data.
function readZipIndex(buf: Buffer): Map<string, ZipEntry> {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  // The EOCD is at the end, followed only by an optional ≤64KB comment.
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a .xlsx file (no ZIP end-of-central-directory record).");

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  if (ptr === 0xffffffff) throw new Error("zip64 .xlsx files aren't supported — re-export as CSV.");

  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const offset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    entries.set(name, { name, offset, method, size });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipFile(buf: Buffer, entry: ZipEntry): string {
  if (buf.readUInt32LE(entry.offset) !== 0x04034b50) {
    throw new Error(`Corrupt .xlsx: bad local header for ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(entry.offset + 26);
  const extraLen = buf.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLen + extraLen;

  if (entry.method === 0) return buf.toString("utf8", start, start + entry.size);
  if (entry.method === 8) {
    // Cap decompressed size: DEFLATE can expand ~1000:1, so an 8 MB upload
    // could otherwise inflate to gigabytes and OOM the instance (zip bomb,
    // or just an accidentally huge export).
    try {
      return inflateRawSync(buf.subarray(start), {
        maxOutputLength: MAX_INFLATED_BYTES,
      }).toString("utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE") {
        throw new Error(
          `.xlsx entry ${entry.name} decompresses past ${MAX_INFLATED_BYTES / 1024 / 1024} MB — re-export a smaller file (or CSV).`,
        );
      }
      throw e;
    }
  }
  throw new Error(`Unsupported ZIP compression method ${entry.method} in ${entry.name}`);
}

// ---------------------------------------------------------------------------
// XML bits
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    // OOXML encodes control chars in shared strings as _xHHHH_ (e.g. newline
    // is _x000A_). Without this, multiline descriptions collapse to one line.
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

// OOXML may be written with or without namespace prefixes — `<sheet>` and
// `<x:sheet>` are the same element, and exporters differ (ninety's rocks
// workbook is unprefixed; its to-dos workbook is prefixed with `x:`). Every
// tag pattern here allows an optional prefix, or a whole file silently reads
// as empty.
const P = "(?:[A-Za-z_][\\w.-]*:)?";

// Element matchers put the self-closing form FIRST: `[^>]*` happily consumes
// the "/" of `<c r="I2"/>`, so an open-tag alternative tried first would match
// it and then run on to the *next* element's closing tag, swallowing a cell.
const EL = (tag: string) =>
  new RegExp(
    `<${P}${tag}\\b[^>]*/>|<${P}${tag}\\b[^>]*>[\\s\\S]*?</${P}${tag}>`,
    "g",
  );
const CELL_RE = EL("c");
const ROW_RE = EL("row");
const SI_RE = EL("si");
const T_RE = EL("t");

// Attribute names can be prefixed too (`r:id`). An unprefixed request matches
// either form, so callers don't have to know which the exporter used.
function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${P}${name}="([^"]*)"`))?.[1];
}

// Concatenates the <t> runs of one string-table entry (rich text splits a
// single value across runs). Self-closing <t/> contributes an empty string.
function textRuns(xml: string): string {
  const runs = xml.match(T_RE) ?? [];
  const selfClosing = new RegExp(`<${P}t\\b[^>]*/>`);
  const tags = new RegExp(`<${P}t\\b[^>]*>|</${P}t>`, "g");
  return runs
    .map((r) => decodeEntities(r.replace(selfClosing, "").replace(tags, "")))
    .join("");
}

// Shared strings are the string table every text cell points into.
export function parseSharedStrings(xml: string): string[] {
  return (xml.match(SI_RE) ?? []).map(textRuns);
}

// "C" → 2, "AB" → 27. Cell refs carry the column, which is how sparse rows
// (skipped empty cells) stay aligned with their headers.
export function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// Excel stores dates as a day count. Serial 61 (1900-03-01) onward counts from
// 1899-12-30, the offset that absorbs Excel's phantom 1900-02-29; serials below
// that predate the bug and count from 1899-12-31. Times are fractions of a day
// and are dropped — the app stores date-only strings.
export function excelSerialToDateString(serial: number): string {
  const epoch = serial < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86400000);
  const d = new Date(epoch + ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Builtin numeric formats that mean "date" (14-17 US date forms, 22 datetime,
// 45-47 elapsed time). Custom formats (id ≥ 164) are classified by their code.
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormatCode(code: string): boolean {
  // Strip quoted literals and color/condition blocks before looking for date
  // tokens, so a currency format like "$"#,##0 can't read as a month code.
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  return /[ymd]/i.test(stripped) && !/^[^ymd]*general[^ymd]*$/i.test(stripped);
}

// Maps each cell-style index to whether it formats as a date.
function parseDateStyles(stylesXml: string): boolean[] {
  // Attributes are read by name, not position — exporters write them in any
  // order (ninety puts formatCode before numFmtId).
  const customDate = new Map<number, boolean>();
  for (const tag of stylesXml.match(new RegExp(`<${P}numFmt\\b[^>]*/?>`, "g")) ?? []) {
    const id = attr(tag, "numFmtId");
    const code = attr(tag, "formatCode");
    if (id !== undefined && code !== undefined) {
      customDate.set(Number(id), isDateFormatCode(decodeEntities(code)));
    }
  }

  const cellXfs =
    stylesXml.match(new RegExp(`<${P}cellXfs\\b[^>]*>[\\s\\S]*?</${P}cellXfs>`))?.[0] ?? "";
  const out: boolean[] = [];
  for (const xf of cellXfs.match(new RegExp(`<${P}xf\\b[^>]*/?>`, "g")) ?? []) {
    const id = Number(attr(xf, "numFmtId") ?? 0);
    out.push(customDate.get(id) ?? BUILTIN_DATE_FORMATS.has(id));
  }
  return out;
}

// Exported for tests: sheet XML → rows, given the workbook's string table and
// which style indexes format as dates.
export function parseSheetXml(
  xml: string,
  shared: string[],
  dateStyles: boolean[],
): string[][] {
  const rows: string[][] = [];

  for (const rowXml of xml.match(ROW_RE) ?? []) {
    const row: string[] = [];
    for (const cellXml of rowXml.match(CELL_RE) ?? []) {
      const ref = attr(cellXml, "r");
      const type = attr(cellXml, "t") ?? "n";
      const style = Number(attr(cellXml, "s") ?? -1);

      let value = "";
      if (type === "inlineStr") {
        value = textRuns(cellXml);
      } else {
        const raw =
          cellXml.match(new RegExp(`<${P}v\\b[^>]*>([\\s\\S]*?)</${P}v>`))?.[1] ?? "";
        if (raw === "") value = "";
        else if (type === "s") value = shared[Number(raw)] ?? "";
        else if (type === "str" || type === "e") value = decodeEntities(raw);
        else if (type === "b") value = raw === "1" ? "Yes" : "No";
        else {
          // Numeric: a date-formatted cell holds a serial, not a number.
          const n = Number(raw);
          value =
            !Number.isNaN(n) && style >= 0 && dateStyles[style]
              ? excelSerialToDateString(n)
              : raw;
        }
      }

      const idx = ref ? columnIndex(ref) : row.length;
      while (row.length < idx) row.push("");
      row[idx] = value;
    }
    rows.push(row);
  }

  // Trailing all-blank rows are an artifact of the sheet dimension, not data.
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export type XlsxSheet = { name: string; rows: string[][] };

export function readXlsx(buf: Buffer): XlsxSheet[] {
  const zip = readZipIndex(buf);
  const read = (name: string): string | null => {
    const entry = zip.get(name);
    return entry ? readZipFile(buf, entry) : null;
  };

  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new Error("Not a valid .xlsx file (no xl/workbook.xml).");

  const shared = parseSharedStrings(read("xl/sharedStrings.xml") ?? "");
  const dateStyles = parseDateStyles(read("xl/styles.xml") ?? "");

  // Sheet order and names live in workbook.xml; the file each one lives in is
  // resolved through the relationship ids in workbook.xml.rels.
  const rels = new Map<string, string>();
  for (const tag of (read("xl/_rels/workbook.xml.rels") ?? "").match(
    new RegExp(`<${P}Relationship\\b[^>]*/?>`, "g"),
  ) ?? []) {
    const id = attr(tag, "Id");
    const target = attr(tag, "Target");
    if (id && target) {
      rels.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
    }
  }

  // Attributes are read by name rather than matched in sequence — writers
  // order them freely, and a positional pattern silently yields no sheets on
  // one that puts r:id before name.
  const sheets: XlsxSheet[] = [];
  for (const [i, tag] of (
    workbook.match(new RegExp(`<${P}sheet\\b[^>]*/?>`, "g")) ?? []
  ).entries()) {
    const rawName = attr(tag, "name");
    const relId = attr(tag, "id");
    if (!rawName) continue;
    const target = (relId && rels.get(relId)) || `worksheets/sheet${i + 1}.xml`;
    const xml = read(`xl/${target}`);
    if (!xml) continue;
    sheets.push({ name: decodeEntities(rawName), rows: parseSheetXml(xml, shared, dateStyles) });
  }
  return sheets;
}

// Picks the sheet to import: an explicit name (case-insensitive), else the
// first whose name matches `prefer` (e.g. /rock/i), else the first sheet.
export function pickSheet(
  sheets: XlsxSheet[],
  explicit: string | undefined,
  prefer: RegExp,
): XlsxSheet {
  if (sheets.length === 0) throw new Error("Workbook has no sheets.");
  if (explicit) {
    const found = sheets.find((s) => s.name.trim().toLowerCase() === explicit.trim().toLowerCase());
    if (!found) {
      throw new Error(
        `No sheet named "${explicit}". Available: ${sheets.map((s) => s.name).join(", ")}`,
      );
    }
    return found;
  }
  return sheets.find((s) => prefer.test(s.name)) ?? sheets[0];
}
