// Pure parsing/normalizing helpers for the CSV importer
// (`scripts/import-csv.ts`). Everything here is IO-free so it can be unit
// tested with `pnpm test`; the script owns Firestore and the filesystem.
//
// The shapes these functions target are ninety.io's CSV exports — the tool the
// client is migrating off of — but nothing here assumes ninety specifically.
// Anything that produces a comparable column set (a spreadsheet a client
// maintains by hand, for instance) imports the same way.

import { mondayOf, toDateString } from "./dates";
import { parseScorecardValue } from "./scorecard";

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

// Exports arrive as comma-separated files, but a table pasted out of Sheets or
// Excel is tab-separated. Sniff the header line rather than making the caller
// care which one they have.
export function detectDelimiter(text: string): "," | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let commas = 0;
  let tabs = 0;
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i++) {
    const c = firstLine[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (inQuotes) continue;
    else if (c === ",") commas++;
    else if (c === "\t") tabs++;
  }
  return tabs > commas ? "\t" : ",";
}

// RFC 4180 parser: quoted fields, doubled quotes, embedded delimiters and
// newlines. Rows that are entirely blank are dropped (trailing newline, and
// the separator rows some exports emit between sections).
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delim = delimiter ?? detectDelimiter(src);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (c === "\r") {
        // Normalize CRLF inside a quoted cell to a bare newline.
        field += "\n";
        i += src[i + 1] === "\n" ? 2 : 1;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delim) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export type CsvTable = {
  headers: string[];
  rows: Record<string, string>[];
};

// Header lookup is case- and whitespace-insensitive so "Due Date", "due date",
// and "DUE  DATE" all resolve. First occurrence wins on duplicates.
export function toTable(rows: string[][]): CsvTable {
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const indexByKey = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = headerKey(h);
    if (key && !indexByKey.has(key)) indexByKey.set(key, i);
  });

  const out = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h && rec[h] === undefined) rec[h] = (r[i] ?? "").trim();
    });
    return rec;
  });

  return { headers, rows: out };
}

export function headerKey(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

// Reads a cell by any of several accepted header spellings.
export function cell(
  row: Record<string, string>,
  headers: string[],
  ...names: string[]
): string {
  for (const name of names) {
    const match = headers.find((h) => headerKey(h) === headerKey(name));
    if (match !== undefined) {
      const v = row[match];
      if (v !== undefined && v.trim() !== "") return v.trim();
    }
  }
  return "";
}

// Description fields from ninety exports often lose the blank line between a
// short label and the body (e.g. CliftonStrengths: "AnalyticalBecause of
// your strengths…" instead of "Analytical\n\nBecause…"). Restore that break
// for display/import; leave real multiline text alone.
//
// Also normalizes CRLF → LF so `whitespace-pre-wrap` renders cleanly.
export function normalizeDescription(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = String(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!s.includes("\n")) {
    // One-word (optional hyphenated) label glued to a capitalized body.
    // "Because/You/Your/Perhaps/Sometimes/Chances" covers the strengths copy
    // and similar labeled notes without splitting normal titles.
    const m = s.match(
      /^([A-Z][A-Za-z]{1,24}(?:-[A-Z][A-Za-z]{1,24})?)((?:Because|You|Your|Perhaps|Sometimes|Chances)\b[\s\S]+)$/,
    );
    if (m) s = `${m[1]}\n\n${m[2]}`;
  }
  return s.trim();
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Accepts the formats exports actually emit: "2026-07-27", "2026-07-27T14:00:00Z",
// "7/27/2026", "07/27/26", "Jul 27, 2026", "27 July 2026". Returns a local
// YYYY-MM-DD string, or null when the cell is empty/unparseable.
//
// ISO strings carrying a time are read in UTC — ninety timestamps a due date as
// midnight UTC, and reading those with local getters rolls the date back a day
// anywhere west of Greenwich.
export function parseDateOnly(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    if (/[T ]\d{1,2}:/.test(s)) {
      const t = Date.parse(s);
      if (!Number.isNaN(t)) {
        const dt = new Date(t);
        return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
      }
    }
    return `${y}-${pad(Number(m))}-${pad(Number(d))}`;
  }

  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    const year = expandYear(Number(slash[3]));
    if (isValidYmd(year, month, day)) return `${year}-${pad(month)}-${pad(day)}`;
    return null;
  }

  const monthFirst = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/);
  if (monthFirst && MONTHS[monthFirst[1].slice(0, 3).toLowerCase()] !== undefined) {
    const month = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()] + 1;
    const day = Number(monthFirst[2]);
    const year = monthFirst[3] ? Number(monthFirst[3]) : new Date().getFullYear();
    if (isValidYmd(year, month, day)) return `${year}-${pad(month)}-${pad(day)}`;
    return null;
  }

  const dayFirst = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?/);
  if (dayFirst && MONTHS[dayFirst[2].slice(0, 3).toLowerCase()] !== undefined) {
    const month = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()] + 1;
    const day = Number(dayFirst[1]);
    const year = dayFirst[3] ? Number(dayFirst[3]) : new Date().getFullYear();
    if (isValidYmd(year, month, day)) return `${year}-${pad(month)}-${pad(day)}`;
    return null;
  }

  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function expandYear(y: number): number {
  if (y >= 1000) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// Turns a scorecard week column header into the Monday the app buckets on.
// Handles "Jul 27 - Aug 2", "Jul 27 - Aug 2, 2026", "7/27 - 8/2", "7/27/2026".
//
// Week headers usually carry no year, so an undated header resolves to
// whichever candidate year puts it closest to `anchor` (default: today). That
// is correct for a 13-week export and rolls Dec→Jan cleanly; for an export more
// than ~6 months stale, pass the date it was taken as the anchor.
// Returns null for non-week columns (Owner, Goal, Average, …) so callers can
// use it as the "is this a week column?" test.
export function parseWeekHeader(header: string, anchor: Date = new Date()): string | null {
  const h = (header ?? "").trim();
  if (!h) return null;

  const iso = h.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const start = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return toDateString(mondayOf(start));
  }

  const explicitYear = h.match(/\b(19|20)\d{2}\b/);
  const year = explicitYear ? Number(explicitYear[0]) : null;

  const named = h.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/);
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      return resolveWeek(month, Number(named[2]), year, anchor);
    }
  }

  const numeric = h.match(/\b(\d{1,2})[/](\d{1,2})(?:[/](\d{2,4}))?\b/);
  if (numeric) {
    const explicit = numeric[3] ? expandYear(Number(numeric[3])) : year;
    return resolveWeek(Number(numeric[1]) - 1, Number(numeric[2]), explicit, anchor);
  }

  return null;
}

function resolveWeek(
  monthIdx: number,
  day: number,
  year: number | null,
  anchor: Date,
): string | null {
  if (monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31) return null;

  if (year !== null) {
    if (!isValidYmd(year, monthIdx + 1, day)) return null;
    return toDateString(mondayOf(new Date(year, monthIdx, day)));
  }

  const anchorYear = anchor.getFullYear();
  let best: Date | null = null;
  for (const y of [anchorYear - 1, anchorYear, anchorYear + 1]) {
    if (!isValidYmd(y, monthIdx + 1, day)) continue;
    const candidate = new Date(y, monthIdx, day);
    if (
      best === null ||
      Math.abs(candidate.getTime() - anchor.getTime()) <
        Math.abs(best.getTime() - anchor.getTime())
    ) {
      best = candidate;
    }
  }
  return best ? toDateString(mondayOf(best)) : null;
}

// ---------------------------------------------------------------------------
// Numbers, goals, units
// ---------------------------------------------------------------------------

// Scorecard cell → number. Same rules as live entry (`parseScorecardValue`):
// "$1,234", "12.5%", "(400)" as -400, "Yes"/"No" as 1/0, "1:30" as 90 minutes.
// Invalid text is null here (import skips the cell) rather than an error.
export function parseNumericValue(raw: string): number | null {
  const parsed = parseScorecardValue(raw);
  return parsed.ok ? parsed.value : null;
}

export type MetricUnit = "number" | "currency" | "percent" | "yesno" | "time";
export type GoalDirection = "gte" | "lte" | "eq";

export type ParsedGoal = {
  goal: number | null;
  direction: GoalDirection;
  unit: MetricUnit;
};

// Ninety writes goals as "≥ 40", ">= 40", "Greater Than or Equal To 40",
// "$1,000,000", "95%", or a bare number. Direction defaults to "at least",
// which is what an unqualified EOS target means.
export function parseGoal(raw: string): ParsedGoal {
  const s = (raw ?? "").trim();
  const lower = s.toLowerCase();

  let direction: GoalDirection = "gte";
  if (/≥|>=|=>|at least|greater than or equal|or (?:more|greater|above)|minimum|min\b/.test(lower)) {
    direction = "gte";
  } else if (/≤|<=|=<|at most|less than or equal|or (?:less|fewer|below)|maximum|max\b/.test(lower)) {
    direction = "lte";
  } else if (/^\s*[<]/.test(lower) || /\bless than\b|\bunder\b|\bbelow\b/.test(lower)) {
    direction = "lte";
  } else if (/^\s*[>]/.test(lower) || /\bgreater than\b|\bover\b|\babove\b/.test(lower)) {
    direction = "gte";
  } else if (/^\s*=|\bexactly\b|\bequal to\b/.test(lower)) {
    direction = "eq";
  }

  let unit: MetricUnit = "number";
  if (s.includes("$")) unit = "currency";
  else if (s.includes("%")) unit = "percent";
  else if (/^\s*(yes|no|y|n|true|false)\s*$/i.test(s)) unit = "yesno";
  else if (/\d+:[0-5]\d/.test(s)) unit = "time";

  // Strip comparator words/symbols before reading the number, so
  // "Greater Than or Equal To 40" doesn't parse as null.
  const numericPart = s
    .replace(/greater than or equal to|less than or equal to|at least|at most|equal to|greater than|less than|exactly|minimum|maximum/gi, "")
    .replace(/[≥≤<>=]/g, "")
    .trim();

  return { goal: parseNumericValue(numericPart), direction, unit };
}

// A metric's unit is often only discoverable from its values ("$412,000") when
// the goal column is blank. Falls back to the goal-derived unit.
export function inferUnit(goalUnit: MetricUnit, sampleValues: string[]): MetricUnit {
  if (goalUnit !== "number") return goalUnit;
  const samples = sampleValues.filter((v) => v.trim() !== "");
  if (samples.length === 0) return "number";
  if (samples.some((v) => v.includes("$"))) return "currency";
  if (samples.some((v) => v.includes("%"))) return "percent";
  if (samples.every((v) => /^\s*(yes|no|y|n)\s*$/i.test(v))) return "yesno";
  if (samples.some((v) => /^\d+:[0-5]\d$/.test(v.trim()))) return "time";
  return "number";
}

// ---------------------------------------------------------------------------
// Rocks
// ---------------------------------------------------------------------------

export type RockStatus = "on_track" | "off_track" | "done" | "cancelled";
export type RockType = "company" | "department" | "individual";

// Maps whatever the export calls it onto the app's four statuses. A row with a
// "Completed On" date is done regardless of what the status column says —
// exports routinely leave status as "On Track" on finished rocks.
export function normalizeRockStatus(raw: string, completedOn: string | null): RockStatus {
  const s = (raw ?? "").trim().toLowerCase().replace(/[-_]/g, " ");
  if (/complete|done|finished|achieved/.test(s)) return "done";
  if (/cancel|abandon|archiv|dropped|deleted/.test(s)) return "cancelled";
  if (/off ?track|at risk|behind|red|missed|incomplete|not done/.test(s)) return "off_track";
  if (/on ?track|green|active|in progress|started|open/.test(s)) {
    return completedOn ? "done" : "on_track";
  }
  if (completedOn) return "done";
  return "on_track";
}

// Ninety's "Level" column (Company / Department / Individual|Personal).
export function normalizeRockType(raw: string): RockType {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.startsWith("comp")) return "company";
  if (s.startsWith("dep") || s.startsWith("team") || s.startsWith("div")) return "department";
  return "individual";
}

// Accepts "2026-Q3", "Q3 2026", "Q3-2026", "2026 Q3" and normalizes them to the
// app's "YYYY-Qn"; falls back to deriving the quarter from the due date; null
// when neither is available.
//
// A **fiscal** label ("Q2 FY 2026") is kept verbatim instead: a fiscal quarter
// doesn't line up with the calendar one, and the app only renders this string
// as a label, so echoing the client's own vocabulary beats silently relabelling
// their rock as a quarter it isn't in.
export function normalizeQuarter(raw: string, dueDate: string | null): string | null {
  const s = (raw ?? "").trim();
  if (s) {
    if (/\bfy\b|\bfiscal\b/i.test(s)) return s;
    const yq = s.match(/\b(20\d{2})\D{0,3}q([1-4])\b/i);
    if (yq) return `${yq[1]}-Q${yq[2]}`;
    const qy = s.match(/\bq([1-4])\D{0,3}(20\d{2})\b/i);
    if (qy) return `${qy[2]}-Q${qy[1]}`;
    // An unrecognized but non-empty label is still the client's own wording.
    if (/q[1-4]|quarter|\b20\d{2}\b/i.test(s)) return s;
  }
  if (dueDate) {
    const [y, m] = dueDate.split("-").map(Number);
    if (y && m) return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

// Normalizes a person's name for matching: case, punctuation, extra spaces, and
// "Last, First" ordering. Emails collapse to the address itself.
export function normalizePersonKey(raw: string): string {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s.includes("@")) return s.replace(/\s+/g, "");
  if (s.includes(",")) {
    const [last, ...rest] = s.split(",");
    s = `${rest.join(" ").trim()} ${last.trim()}`;
  }
  return s
    .replace(/[.]/g, " ")
    .replace(/[^a-z0-9\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Case/punctuation/whitespace-insensitive key for matching titles between
// files (a milestone's "Rock Name" against a rock's "Title") and for building
// stable doc ids.
export function normalizeKey(raw: string): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugify(raw: string, max = 40): string {
  return (
    (raw ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "x"
  );
}

// FNV-1a. Deterministic and dependency-free — used to build stable Firestore
// doc ids so re-running an import updates rows in place instead of duplicating
// them. Not a security hash; collisions across a team's few hundred rows are
// not a practical concern.
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Stable doc id for an imported row. Keyed on team + kind + a natural key
// (metric name, rock title, rock+milestone title) so the same CSV re-imported
// overwrites rather than duplicates. The readable slug is a debugging
// affordance — the hash is what guarantees uniqueness.
export function importDocId(kind: string, teamId: string, naturalKey: string): string {
  const key = normalizeKey(naturalKey) || naturalKey.trim().toLowerCase();
  return `imp-${kind}-${slugify(naturalKey, 32)}-${stableHash(`${teamId}|${kind}|${key}`)}`;
}
