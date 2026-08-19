// Client-safe types for the Import UI (not a "use server" module).

import type { ImportReport } from "@/lib/team-import-types";

export type { WebImportKind } from "@/lib/import-headers";

/**
 * Sentinel for the "Unmatched owner" dropdown: import the row with No Owner
 * and keep the unmatched name in the description, rather than skipping it or
 * parking it on a stand-in member. Cannot collide with a Firebase uid.
 */
export const NO_OWNER = "__no_owner__";

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
