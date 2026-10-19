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
//   ok        an export that produced a file, for any user. This row FAILS
//             CLOSED: it is written before the file leaves the server, and
//             if the write fails the export is refused. An export that could
//             leave no trace is exactly what the audit trail exists to rule
//             out. Never deduped: every file is its own row.
//   refused   an attempt the core turned away — no session (401), account
//             gone or disabled (403), bad parameters (400), no such page,
//             no access to it or no such team (404), over the row cap (413).
//             Best effort: the request is refused either way, so a failed
//             write is logged, not surfaced. DEDUPED: at most one row per
//             (uid or "anonymous", export id, reason) per 10-minute window,
//             so a retry loop or a scripted probe can't flood the trail.
//
// The dedupe needs no client-writable state and no read: the row's doc id is
// derived from the key and the window (refusedAuditDocId), and it is written
// with create(), which fails ALREADY_EXISTS when the window already has its
// row. Ids that came from the URL are hashed into the doc id, never spliced
// in raw, and an id that isn't a real export counts as one key ("(unknown)"),
// so made-up ids can't mint unlimited rows.
//
// Row shape (shares the audit_log core fields):
//   entity_type  "data_export"
//   action       "data_export"
//   entity_id    the export id (the page), e.g. "todos"
//   actor_uid    who exported (or tried to); null for no session
//   actor_source "app"
//   team_id      the team the view belongs to, or null
//   outcome      "ok" | "refused"
//   reason       null when ok; why it was refused, e.g. "no_page_access"
//   http_status  200, or the refusal's status
//   export       { page, format, filters, row_count, app_version, query,
//                  file_name }
//   dedupe_window  refused rows only: the window's start (ISO, UTC)
//   timestamp    server time

import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { ExportFilterLine, ExportFormat } from "./types";

export type DataExportOutcome = "ok" | "refused";

export type DataExportInput = {
  /** null: no session. */
  actorUid: string | null;
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
  /** The file's name (ok rows): page, team, view and Mountain time. */
  fileName?: string | null;
};

// Ids and query strings on refused rows come straight from the URL.
const MAX_ID = 128;
const MAX_QUERY = 1_000;

/** The refused-attempt dedupe window. */
export const REFUSED_DEDUPE_MS = 10 * 60 * 1000;

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
      file_name: input.fileName ?? null,
    },
  };
}

/** Append an "ok" row. Throws on failure — the caller must not send the file. */
export async function recordDataExport(
  db: Firestore,
  input: DataExportInput,
): Promise<void> {
  await db
    .collection("audit_log")
    .add({ ...dataExportRow(input), timestamp: FieldValue.serverTimestamp() });
}

/** Start of the 10-minute window `now` falls in. */
export function refusedWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / REFUSED_DEDUPE_MS) * REFUSED_DEDUPE_MS);
}

/**
 * The dedupe key's doc id: one per (actor, export, reason, window).
 * `exportKey` is the export id when it names a real export, else
 * "(unknown)" — the caller decides (lib/export/run.ts).
 */
export function refusedAuditDocId(
  actorUid: string | null,
  exportKey: string,
  reason: string,
  now: Date,
): string {
  const key = [actorUid ?? "anonymous", exportKey, reason].join("\u0000");
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 40);
  return `data_export_refused__${hash}__${refusedWindowStart(now).getTime()}`;
}

function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists";
}

/**
 * Record a refused attempt, deduped (see the header). Resolves `false` when
 * this window already had the row, `true` when it wrote one. Other failures
 * throw; the core logs them and refuses anyway.
 */
export async function recordRefusedExport(
  db: Firestore,
  input: DataExportInput & { exportKey: string; now: Date },
): Promise<boolean> {
  const { exportKey, now, ...row } = input;
  const reason = row.reason ?? "refused";
  const id = refusedAuditDocId(row.actorUid, exportKey, reason, now);
  try {
    await db
      .collection("audit_log")
      .doc(id)
      .create({
        ...dataExportRow({ ...row, outcome: "refused", reason }),
        dedupe_window: refusedWindowStart(now).toISOString(),
        timestamp: FieldValue.serverTimestamp(),
      });
    return true;
  } catch (err) {
    if (isAlreadyExists(err)) return false;
    throw err;
  }
}
