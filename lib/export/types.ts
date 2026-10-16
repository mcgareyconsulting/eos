// Shared vocabulary for data export (feedback row 55, docs/EXPORT.md).
//
// Export is open to every signed-in user, on every page they can open, and
// the file holds exactly what that page shows THEM. A page opts in by
// supplying one `ExportDefinition`: how to read its view from the URL, the
// page's own access rule, how to load exactly the rows that view shows the
// viewer, and its columns. Everything else — the live account check, value
// normalization, the row cap, the audit row, formula-injection protection
// and the CSV itself — is the core's (lib/export/run.ts), so no page can
// skip it.

import type { Firestore } from "firebase-admin/firestore";
import type { Viewer } from "@/lib/access/types";

/** The one export format: a CSV download (opened in Excel; print from there). */
export type ExportFormat = "csv";

/**
 * How a column's raw value is normalized (lib/export/normalize.ts). Pick the
 * kind, not a formatter: dates, names and rich text then read the same on
 * every page. Every cell is text in the file, and no cell names a time
 * zone: every time is America/Denver, the bank's clock (lib/time-zone.ts),
 * which docs/EXPORT.md states once.
 *
 *   text      any value → trimmed string
 *   richtext  stored description markup → plain text (lib/rich-text.ts)
 *   date      a calendar day — `YYYY-MM-DD` string, Timestamp, Date or millis
 *             → `YYYY-MM-DD` (instants are read in Mountain time)
 *   datetime  an instant → `YYYY-MM-DD HH:mm`, Mountain time
 *   boolean   → Yes / No
 *   user      a uid → display name ("Unassigned" for none, "—" unresolved)
 *   number    a finite number; anything else → blank
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
};

/** One filter that shaped the view, e.g. View: Archived (for the audit row). */
export type ExportFilterLine = { label: string; value: string };

/** What a definition's access check and loader get: the viewer and the db. */
export type ExportContext = {
  db: Firestore;
  uid: string;
  /**
   * Built from the session + roster, as every page does
   * (lib/firebase/viewer.ts). `isAdmin` is the admin claim as it stands on
   * the account right now, not only as baked into the session cookie.
   */
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
  /** URL id: /api/export/{id}. Also the audit row's `entity_id`. */
  id: string;
  /** Human title, e.g. "To-Dos" (the audit row). */
  title: string;
  /**
   * The page's view, read from the same query parameters the page itself
   * uses, so the Export control can pass the page's URL state straight
   * through. Return a refusal for a malformed request.
   */
  parseParams(params: URLSearchParams): P | ExportRefusal;
  /**
   * The page's OWN access rule for this viewer — the helper the page itself
   * relies on (e.g. lib/firebase/team-access.ts checkTeamAccess, the rule
   * behind requireTeamAccess), never a parallel one. The core runs it
   * BEFORE `load`, so someone who can't open the page reads none of its
   * data. Return null to allow, or a refusal — the same 404 the page gives,
   * so ids aren't enumerable.
   */
  authorize(ctx: ExportContext, params: P): Promise<ExportRefusal | null>;
  /**
   * Load exactly what the page shows this viewer for `params` — the same
   * queries and the same visibility predicate (lib/access, lib/todo-lists),
   * never more, and no "admin sees everything" shortcut the page itself
   * doesn't have.
   *
   * Honor the row cap early (lib/export/cap.ts): read a query that IS the
   * view through `readCapped` (at most cap + 1 docs), and call
   * `checkRowCap` on in-memory-filtered rows BEFORE any per-row sub-read.
   */
  load(ctx: ExportContext, params: P): Promise<LoadedView<R> | ExportRefusal>;
  columns: readonly ExportColumn<R>[];
};

/** A normalized cell: text, or a number for `number` columns. */
export type ExportCell = string | number;

/** Everything the CSV writer needs, already normalized and access-checked. */
export type ExportTable = {
  title: string;
  headers: string[];
  rows: ExportCell[][];
  /** Full file name, `.csv` included, safe characters only (lib/export/provenance.ts). */
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
