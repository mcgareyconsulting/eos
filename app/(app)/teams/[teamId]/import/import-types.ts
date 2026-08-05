// Client-safe types for the Import UI (not a "use server" module).

import type { ImportReport } from "@/lib/team-import-types";

export type { WebImportKind } from "@/lib/import-headers";

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
