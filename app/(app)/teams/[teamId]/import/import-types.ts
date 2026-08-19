// Client-safe types for the Import UI (not a "use server" module).

import type { ImportReport } from "@/lib/team-import-types";

export type { WebImportKind } from "@/lib/import-headers";

/**
 * Sentinel for the "Unmatched owner" dropdown: drop the row entirely. The
 * default (empty value) imports it with No Owner and keeps the unmatched name
 * in the description. Cannot collide with a Firebase uid.
 */
export const SKIP_ROWS = "__skip_rows__";

export type ImportActionResult =
  | {
      ok: true;
      report: ImportReport;
      preview: {
        filename: string;
        rowCount: number;
        headers: string[];
        sheets: string[];
      };
    }
  | { ok: false; error: string };
