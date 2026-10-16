// Shared vocabulary for admin data export (feedback row 55, docs/EXPORT.md).
//
// A page opts in by supplying one `ExportDefinition`: how to read its view
// from the URL, how to load exactly the rows that view shows, and its
// columns. Everything else — the admin gate, value normalization, the row
// cap, the provenance header, the audit row, formula-injection protection,
// .xlsx and the print view — is the core's (lib/export/run.ts), so no page
// can skip it.

import type { Firestore } from "firebase-admin/firestore";
import type { Viewer } from "@/lib/access/types";

/** `xlsx`: the server-built spreadsheet. `print`: the print view (Save as PDF). */
export type ExportFormat = "xlsx" | "print";

/**
 * How a column's raw value is normalized (lib/export/normalize.ts). Pick the
 * kind, not a formatter: dates, names and rich text then read the same on
 * every page.
 *
 *   text      any value → trimmed string
 *   richtext  stored description markup → plain text (lib/rich-text.ts)
 *   date      a calendar day — `YYYY-MM-DD` string, Timestamp, Date or millis
 *             → a date cell, `YYYY-MM-DD` (instants are read in
 *             America/Denver, the bank's clock — lib/time-zone.ts)
 *   datetime  an instant → a datetime cell, `YYYY-MM-DD HH:mm` Mountain
 *             time (the print view adds MDT/MST)
 *   boolean   → Yes / No
 *   user      a uid → display name ("Unassigned" for none, "—" unresolved)
 *   number    a finite number (a numeric cell); anything else → blank
 */
export type ColumnKind =
  | "text"
  | "richtext"
  | "date"
  | "datetime"
  | "boolean"
  | "user"
  | "number";

export type ExportColumn<R> = {
  /** Stable id — the column snapshot tests pin these. */
  key: string;
  /** Header cell text. */
  header: string;
  kind: ColumnKind;
  /** The raw value for this row; normalization is the core's job. */
  value: (row: R) => unknown;
  /** Spreadsheet column width in characters (default 16). */
  width?: number;
};

/** One "filters applied" line of the provenance header, e.g. View: Archived. */
export type ExportFilterLine = { label: string; value: string };

/** What a definition's loader gets: the signed-in admin and their db. */
export type ExportContext = {
  db: Firestore;
  uid: string;
  /** Built from the session + roster, as every page does (lib/firebase/viewer.ts). */
  viewer: Viewer;
};

/** A loader's answer: the rows of the view, plus how to describe it. */
export type LoadedView<R> = {
  ok: true;
  rows: R[];
  /** Every filter that shaped the view, in the order the page shows them. */
  filters: ExportFilterLine[];
  /** Team the view belongs to, or null for an org-wide page. */
  teamId: string | null;
  /** Short words for the file name (team name, view), slugged by the core. */
  fileNameParts: string[];
  /**
   * Names the loader already holds (the roster). `user` columns resolve
   * through this first; any uid still missing is looked up in `/users`.
   */
  names?: ReadonlyMap<string, string>;
};

/**
 * A request the core refuses, with the HTTP status and the user's message.
 * `reason` is the audit row's machine-readable why; the core fills it in
 * from the status when a definition leaves it out (lib/export/run.ts).
 */
export type ExportRefusal = {
  ok: false;
  status: number;
  message: string;
  reason?: string;
};

export type ExportDefinition<R = unknown, P = unknown> = {
  /** URL id: /api/export/{id}, /print/{id}. Also the audit row's `entity_id`. */
  id: string;
  /** Human title — sheet name, print heading, provenance first line. */
  title: string;
  /**
   * The page's view, read from the same query parameters the page itself
   * uses, so the Export control can pass the page's URL state straight
   * through. Return a refusal for a malformed request.
   */
  parseParams(params: URLSearchParams): P | ExportRefusal;
  /**
   * Load exactly what the page shows this viewer for `params` — the same
   * queries and the same visibility predicate (lib/access, lib/todo-lists),
   * never more. Return a refusal for a team that doesn't exist.
   *
   * Honor the row cap early (lib/export/cap.ts): read a query that IS the
   * view through `readCapped` (at most cap + 1 docs), and call
   * `checkRowCap` on in-memory-filtered rows BEFORE any per-row sub-read.
   */
  load(ctx: ExportContext, params: P): Promise<LoadedView<R> | ExportRefusal>;
  columns: readonly ExportColumn<R>[];
};

/**
 * A spreadsheet date: `serial` is the Excel serial of the Mountain
 * wall-clock date (and time), written as a real date cell; `text` is what
 * the print view shows.
 */
export type ExportDateCell = {
  kind: "date" | "datetime";
  serial: number;
  text: string;
};

/** A normalized cell: text, a number for `number` columns, or a date. */
export type ExportCell = string | number | ExportDateCell;

/** Everything a writer needs, already normalized and admin-checked. */
export type ExportTable = {
  title: string;
  headers: string[];
  widths: number[];
  rows: ExportCell[][];
  /** Provenance lines, label first (lib/export/provenance.ts). */
  provenance: ExportFilterLine[];
  fileName: string;
};

export function isRefusal(v: unknown): v is ExportRefusal {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { ok?: unknown }).ok === false &&
    typeof (v as { status?: unknown }).status === "number"
  );
}
