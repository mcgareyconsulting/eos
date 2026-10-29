// Client-safe types for the Import UI (not a "use server" module).

import type { BulkGridTable, BulkNotice, ImportReport } from "@/lib/team-import-types";

/**
 * Sentinel for the "Unmatched owner" dropdown: drop the row entirely. The
 * default (empty value) imports it with No Owner and keeps the unmatched name
 * in the description. Cannot collide with a Firebase uid.
 */
export const SKIP_ROWS = "__skip_rows__";

export type BulkImportResult =
  | {
      ok: true;
      report: ImportReport;
      /** Every sheet read, with its cells, for the preview grid. */
      tables: BulkGridTable[];
      /** Files / sheets left out, and why. */
      notices: BulkNotice[];
    }
  | { ok: false; error: string };
