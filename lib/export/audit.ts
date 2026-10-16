// The audit rows exports write (docs/EXPORT.md, guardrail 4).
//
// Same pattern as lib/access-audit.ts: a server-side Admin SDK write straight
// into `audit_log`, which the client can never write (firestore.rules
// `allow write: if false`) and which the generic audit trigger skips
// (functions/src/index.ts AUDIT_EXCLUDED_COLLECTIONS), so the row neither
// loops nor needs a rules change.
//
// Two outcomes:
//
//   ok        an export that produced a file. This row FAILS CLOSED: it is
//             written before the file leaves the server, and if the write
//             fails the export is refused. An export that could leave no
//             trace is exactly what the audit trail exists to rule out.
//   refused   a signed-in attempt the core turned away — not an admin (403),
//             bad parameters (400), no such page or team (404), a dead print
//             link (410), over the row cap (413). Best effort: the request is
//             refused either way, so a failed write is logged, not surfaced.
//             No session (401) has no actor and writes nothing.
//
// Row shape (shares the audit_log core fields):
//   entity_type  "data_export"
//   action       "data_export"
//   entity_id    the export id (the page), e.g. "todos"
//   actor_uid    who exported (or tried to)
//   actor_source "app"
//   team_id      the team the view belongs to, or null
//   outcome      "ok" | "refused"
//   reason       null when ok; why it was refused, e.g. "not_admin"
//   http_status  200, or the refusal's status
//   export       { page, format, filters, row_count, app_version, query }
//   timestamp    server time

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { ExportFilterLine, ExportFormat } from "./types";

export type DataExportOutcome = "ok" | "refused";

export type DataExportInput = {
  actorUid: string;
  exportId: string;
  teamId: string | null;
  format: ExportFormat;
  filters: readonly ExportFilterLine[];
  /** Rows in the file; null for a refusal that never counted them. */
  rowCount: number | null;
  appVersion: string;
  /** Defaults to "ok". */
  outcome?: DataExportOutcome;
  reason?: string | null;
  httpStatus?: number;
  /**
   * The query string as requested — only on refusals, where the parsed
   * filters may not exist. Truncated: it is attacker-shaped input.
   */
  query?: string | null;
};

// Ids and query strings on refused rows come straight from the URL.
const MAX_ID = 128;
const MAX_QUERY = 1_000;

export function dataExportRow(input: DataExportInput) {
  const outcome = input.outcome ?? "ok";
  return {
    entity_type: "data_export" as const,
    action: "data_export" as const,
    entity_id: input.exportId.slice(0, MAX_ID),
    actor_uid: input.actorUid,
    actor_source: "app" as const,
    team_id: input.teamId,
    outcome,
    reason: outcome === "ok" ? null : (input.reason ?? "refused"),
    http_status: input.httpStatus ?? 200,
    export: {
      page: input.exportId.slice(0, MAX_ID),
      format: input.format,
      // Label → value, so a BigQuery query can read one filter directly.
      filters: Object.fromEntries(input.filters.map((f) => [f.label, f.value])),
      row_count: input.rowCount,
      app_version: input.appVersion,
      query: input.query == null ? null : input.query.slice(0, MAX_QUERY),
    },
  };
}

/** Append the row. Throws on failure — for an "ok" row the caller must not send the file. */
export async function recordDataExport(
  db: Firestore,
  input: DataExportInput,
): Promise<void> {
  await db
    .collection("audit_log")
    .add({ ...dataExportRow(input), timestamp: FieldValue.serverTimestamp() });
}
