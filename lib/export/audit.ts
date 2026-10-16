// The audit row every export writes (docs/EXPORT.md, guardrail 4).
//
// Same pattern as lib/access-audit.ts: a server-side Admin SDK write straight
// into `audit_log`, which the client can never write (firestore.rules
// `allow write: if false`) and which the generic audit trigger skips
// (functions/src/index.ts AUDIT_EXCLUDED_COLLECTIONS), so the row neither
// loops nor needs a rules change.
//
// Unlike access_change rows, this one FAILS CLOSED: it is written before the
// file leaves the server, and if the write fails the export is refused. An
// export that could leave no trace is exactly what the audit trail exists to
// rule out.
//
// Row shape (shares the audit_log core fields):
//   entity_type  "data_export"
//   action       "data_export"
//   entity_id    the export id (the page), e.g. "todos"
//   actor_uid    the admin who exported
//   actor_source "app"
//   team_id      the team the view belongs to, or null
//   export       { page, format, filters, row_count, app_version }
//   timestamp    server time

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { ExportFilterLine, ExportFormat } from "./types";

export type DataExportInput = {
  actorUid: string;
  exportId: string;
  teamId: string | null;
  format: ExportFormat;
  filters: readonly ExportFilterLine[];
  rowCount: number;
  appVersion: string;
};

export function dataExportRow(input: DataExportInput) {
  return {
    entity_type: "data_export" as const,
    action: "data_export" as const,
    entity_id: input.exportId,
    actor_uid: input.actorUid,
    actor_source: "app" as const,
    team_id: input.teamId,
    export: {
      page: input.exportId,
      format: input.format,
      // Label → value, so a BigQuery query can read one filter directly.
      filters: Object.fromEntries(input.filters.map((f) => [f.label, f.value])),
      row_count: input.rowCount,
      app_version: input.appVersion,
    },
  };
}

/** Append the row. Throws on failure — the caller must not send the file. */
export async function recordDataExport(
  db: Firestore,
  input: DataExportInput,
): Promise<void> {
  await db
    .collection("audit_log")
    .add({ ...dataExportRow(input), timestamp: FieldValue.serverTimestamp() });
}
