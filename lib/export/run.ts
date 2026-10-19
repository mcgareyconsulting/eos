// The export core (feedback row 55, docs/EXPORT.md). The one door — the CSV
// route (app/api/export/[exportId]/route.ts) — goes through this module, so
// every guardrail below holds for every page:
//
//   1. Open to every signed-in user, locked to what each one can see
//      (Daniel 2026-10-16). Re-checked here on every request, in this
//      order, before any of the page's data is read:
//        a. the session verifies;
//        b. the account is live: it still exists in Identity Platform and is
//           not disabled (deactivation disables it — lib/firebase/deactivate.ts),
//           and the admin claim is re-read from it, not trusted from a
//           cookie up to 25 hours old;
//        c. the page exists and its parameters parse;
//        d. the page's OWN access rule passes for this viewer
//           (definition.authorize — e.g. team membership, as requireTeamAccess).
//      The Export control being on the page is a convenience, not the gate.
//   2. Exactly the page's view for this viewer: the definition loads with
//      the page's own queries and visibility predicate — never more than
//      the page shows them. Admins see what admins see on the page; nobody
//      else gets an admin shortcut.
//   3. Provenance in the file name and the audit row (lib/export/provenance.ts).
//   4. One audit_log row per successful export, written BEFORE the file is
//      released; if it can't be written, nothing is sent (lib/export/audit.ts).
//      Refused attempts are audited too, deduped per 10-minute window.
//   5. Formula-injection protection — in the CSV writer, for every cell.
//   6. Nothing is persisted: the table lives in this request's memory and
//      goes straight into the response.
//   7. Values normalized by column kind; a row cap refuses an oversize view
//      with a message to narrow it (it never silently truncates — a partial
//      file handed to an auditor is worse than none). Loaders honor it early
//      (lib/export/cap.ts); the core re-checks before resolving names.
//
// Test seam: production callers never pass `deps`.

import type { Firestore } from "firebase-admin/firestore";
import type { Viewer } from "@/lib/access/types";
import { recordDataExport, recordRefusedExport } from "./audit";
import { EXPORT_ROW_CAP, overCapRefusal } from "./cap";
import { normalizeCell } from "./normalize";
import { appVersion, exportFileName } from "./provenance";
import { EXPORT_DEFINITIONS } from "./registry";
import {
  isRefusal,
  type ExportDefinition,
  type ExportFilterLine,
  type ExportFormat,
  type ExportRefusal,
  type ExportTable,
} from "./types";

export { EXPORT_ROW_CAP, overCapMessage } from "./cap";

export const NOT_SIGNED_IN = "Your session has ended. Sign in again to export.";
export const ACCOUNT_INACTIVE =
  "Your account is no longer active, so it can't export. Contact an admin.";
export const UNKNOWN_EXPORT = "This page has no export.";
export const AUDIT_FAILED =
  "The export could not be recorded in the audit trail, so it was not sent. Try again.";

/** The signed-in person, as the core needs them. */
export type ExportUser = {
  uid: string;
  /**
   * The account exists and is not disabled, read live from Identity
   * Platform on this request.
   */
  active: boolean;
  /** The admin claim on the session AND on the account right now. */
  isAdmin: boolean;
  db: Firestore;
};

export type RunExportDeps = {
  user?: () => Promise<ExportUser | null>;
  /** The db for an attempt with no session (its refusal is still audited). */
  db?: () => Firestore;
  viewer?: (db: Firestore, uid: string, isAdmin: boolean) => Promise<Viewer>;
  names?: (db: Firestore, uids: readonly string[]) => Promise<Map<string, string>>;
  record?: typeof recordDataExport;
  recordRefused?: typeof recordRefusedExport;
  definitions?: Readonly<Record<string, ExportDefinition<never, never>>>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
};

export type ExportResult = { ok: true; table: ExportTable } | ExportRefusal;

function refuse(status: number, message: string, reason?: string): ExportRefusal {
  return { ok: false, status, message, ...(reason ? { reason } : {}) };
}

/** The audit `reason` for a refusal a definition returned without one. */
export function refusalReason(r: ExportRefusal): string {
  if (r.reason) return r.reason;
  switch (r.status) {
    case 400:
      return "bad_params";
    case 401:
      return "not_signed_in";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 413:
      return "over_cap";
    default:
      return "refused";
  }
}

/**
 * The session user, with the account re-read from Identity Platform:
 * exists, not disabled, and the admin claim as it stands now. Imported
 * lazily so the pure parts of this module (and their tests) never load
 * next/headers or initialize firebase-admin.
 */
async function sessionUser(): Promise<ExportUser | null> {
  const [{ verifySession }, { tokenIsAdmin }, { getAdminAuth, getAdminDb }] =
    await Promise.all([
      import("@/lib/firebase/session"),
      import("@/lib/firebase/admin-claim"),
      import("@/lib/firebase/admin"),
    ]);
  const decoded = await verifySession();
  if (!decoded) return null;
  let active = false;
  let isAdmin = false;
  try {
    const record = await getAdminAuth().getUser(decoded.uid);
    active = !record.disabled;
    isAdmin = active && tokenIsAdmin(decoded) && record.customClaims?.role === "admin";
  } catch (err) {
    // auth/user-not-found: the account is gone. Anything else is an outage,
    // which must not fail open either.
    if ((err as { code?: unknown } | null)?.code !== "auth/user-not-found") {
      console.error("export account check failed", decoded.uid, err);
    }
  }
  return { uid: decoded.uid, active, isAdmin, db: getAdminDb() };
}

async function defaultDb(): Promise<Firestore> {
  const { getAdminDb } = await import("@/lib/firebase/admin");
  return getAdminDb();
}

async function defaultViewer(db: Firestore, uid: string, isAdmin: boolean) {
  const { loadViewer } = await import("@/lib/firebase/viewer");
  return loadViewer(db, uid, isAdmin);
}

async function defaultNames(db: Firestore, uids: readonly string[]) {
  const { loadUserNames } = await import("@/lib/firebase/user-names");
  return loadUserNames(db, uids);
}

/** One request, from the moment we know who is asking (or that no one is). */
type Attempt = {
  uid: string | null;
  db: Firestore;
  exportId: string;
  /** The dedupe key's export part: the id if it is a real export, else "(unknown)". */
  exportKey: string;
  format: ExportFormat;
  deps: RunExportDeps;
  version: string;
  now: Date;
  /** The view's query string as requested, for refused rows. */
  query: string | null;
};

/**
 * Audit a refused attempt (outcome "refused", deduped per window), then hand
 * the refusal back. Best effort: the request is refused either way, so a
 * failed write is logged rather than turned into a different answer.
 */
async function refused(
  a: Attempt,
  refusal: ExportRefusal,
  known: { filters?: readonly ExportFilterLine[]; teamId?: string | null; rowCount?: number } = {},
): Promise<ExportRefusal> {
  try {
    await (a.deps.recordRefused ?? recordRefusedExport)(a.db, {
      actorUid: a.uid,
      exportId: a.exportId,
      exportKey: a.exportKey,
      teamId: known.teamId ?? null,
      format: a.format,
      filters: known.filters ?? [],
      rowCount: known.rowCount ?? null,
      appVersion: a.version,
      outcome: "refused",
      reason: refusalReason(refusal),
      httpStatus: refusal.status,
      query: a.query,
      now: a.now,
    });
  } catch (err) {
    console.error("data_export refusal audit write failed", a.exportKey, err);
  }
  return refusal;
}

/** The CSV door: the view named by `params`, as a table, for this viewer. */
export async function runExport(
  exportId: string,
  params: URLSearchParams,
  format: ExportFormat = "csv",
  deps: RunExportDeps = {},
): Promise<ExportResult> {
  const now = (deps.now ?? (() => new Date()))();
  const definitions = deps.definitions ?? EXPORT_DEFINITIONS;
  const def = Object.hasOwn(definitions, exportId)
    ? (definitions[exportId] as unknown as ExportDefinition<unknown, unknown>)
    : undefined;
  const base = {
    exportId,
    exportKey: def ? def.id : "(unknown)",
    format,
    deps,
    version: appVersion(deps.env),
    now,
    query: params.toString(),
  };

  // 1a. Who.
  const user = await (deps.user ?? sessionUser)();
  if (!user) {
    let db: Firestore | null = null;
    try {
      db = deps.db ? deps.db() : await defaultDb();
    } catch (err) {
      console.error("data_export refusal audit: no db", err);
    }
    const no = refuse(401, NOT_SIGNED_IN, "not_signed_in");
    return db ? refused({ ...base, uid: null, db }, no) : no;
  }
  const attempt: Attempt = { ...base, uid: user.uid, db: user.db };

  // 1b. A live account.
  if (!user.active) {
    return refused(attempt, refuse(403, ACCOUNT_INACTIVE, "account_inactive"));
  }

  // 1c. Which page, which view.
  if (!def) return refused(attempt, refuse(404, UNKNOWN_EXPORT, "unknown_export"));
  const parsed = def.parseParams(params);
  if (isRefusal(parsed)) return refused(attempt, parsed);

  // 1d. The page's own access rule, before any of its data is read.
  const viewer = await (deps.viewer ?? defaultViewer)(user.db, user.uid, user.isAdmin);
  const ctx = { db: user.db, uid: user.uid, viewer };
  const denied = await def.authorize(ctx, parsed);
  if (denied) {
    return refused(attempt, { ...denied, reason: denied.reason ?? "no_page_access" });
  }

  // 2. What — the page's view, for this viewer.
  const view = await def.load(ctx, parsed);
  if (isRefusal(view)) return refused(attempt, view);

  // 7. The cap, before any name lookup. Loaders should already have refused
  //    (lib/export/cap.ts); this catches one that didn't.
  if (view.rows.length > EXPORT_ROW_CAP) {
    return refused(attempt, overCapRefusal(view.rows.length), {
      filters: view.filters,
      teamId: view.teamId,
      rowCount: view.rows.length,
    });
  }

  // 7. Normalize. User ids the loader couldn't name come from /users.
  const known = new Map(view.names ?? []);
  const userCols = def.columns.filter((c) => c.kind === "user");
  const missing = new Set<string>();
  for (const row of view.rows) {
    for (const c of userCols) {
      const id = c.value(row);
      if (typeof id === "string" && id !== "" && !known.has(id)) missing.add(id);
    }
  }
  if (missing.size > 0) {
    const found = await (deps.names ?? defaultNames)(user.db, [...missing]);
    for (const [id, name] of found) known.set(id, name);
  }
  const nameOf = (id: string) => known.get(id);
  const rows = view.rows.map((row) =>
    def.columns.map((c) => normalizeCell(c.kind, c.value(row), nameOf)),
  );

  // 3. Provenance: the file name.
  const fileName = exportFileName(def.id, view.fileNameParts, now);

  // 4. Audit, fail closed. Every user, every successful export, no dedupe.
  try {
    await (deps.record ?? recordDataExport)(user.db, {
      actorUid: user.uid,
      exportId: def.id,
      teamId: view.teamId,
      format,
      filters: view.filters,
      rowCount: rows.length,
      appVersion: attempt.version,
      outcome: "ok",
      fileName,
    });
  } catch (err) {
    console.error("data_export audit write failed", def.id, err);
    return refuse(500, AUDIT_FAILED);
  }

  return {
    ok: true,
    table: {
      title: def.title,
      headers: def.columns.map((c) => c.header),
      rows,
      fileName,
    },
  };
}
