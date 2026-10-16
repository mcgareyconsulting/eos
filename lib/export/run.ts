// The export core (feedback row 55, docs/EXPORT.md). Both doors — the .xlsx
// route (app/api/export/[exportId]/route.ts) and the print view
// (app/(print)/print/[exportId]/page.tsx) — go through `runExport`, so every
// guardrail below holds for every page and every format:
//
//   1. Admin only, re-checked here on every request: the session must verify
//      AND the account must hold the admin claim right now (a live Auth read,
//      not just the claim baked into a cookie up to 25 hours ago). The Export
//      control being hidden from non-admins is a convenience, not the gate.
//   2. Exactly the page's view: the definition parses the page's own query
//      parameters and loads with the page's own queries and visibility
//      predicate, for this viewer — never more than the UI shows.
//   3. Provenance header (lib/export/provenance.ts).
//   4. One audit_log row per export, written BEFORE the file is released;
//      if it can't be written, nothing is sent (lib/export/audit.ts).
//   5. Formula-injection protection — in the .xlsx writer, for every cell.
//   6. Nothing is persisted: the table lives in this request's memory and
//      goes straight into the response.
//   8. Values normalized by column kind; a row cap refuses an oversize view
//      with a message to narrow it (it never silently truncates — a partial
//      file handed to an auditor is worse than none).
//
// Test seam: production callers never pass `deps`.

import type { Firestore } from "firebase-admin/firestore";
import type { Viewer } from "@/lib/access/types";
import { recordDataExport } from "./audit";
import { normalizeCell } from "./normalize";
import {
  appVersion,
  exportFileName,
  exporterLabel,
  provenanceLines,
} from "./provenance";
import { EXPORT_DEFINITIONS } from "./registry";
import {
  isRefusal,
  type ExportDefinition,
  type ExportFormat,
  type ExportRefusal,
  type ExportTable,
} from "./types";

/** Largest view an export will produce. */
export const EXPORT_ROW_CAP = 5_000;

export const NOT_SIGNED_IN = "Your session has ended. Sign in again to export.";
export const NOT_ADMIN = "Only admins can export data.";
export const UNKNOWN_EXPORT = "This page has no export.";
export const AUDIT_FAILED =
  "The export could not be recorded in the audit trail, so it was not sent. Try again.";

export function overCapMessage(rows: number, cap = EXPORT_ROW_CAP): string {
  return (
    `This view has ${rows.toLocaleString("en-US")} rows; exports are limited to ` +
    `${cap.toLocaleString("en-US")}. Narrow the filters (owner, team, active or ` +
    `archived, period) and export again.`
  );
}

/** The signed-in person, as the core needs them. */
export type ExportUser = {
  uid: string;
  email: string | null;
  name: string | null;
  /** The admin claim on the session AND on the account right now. */
  isAdmin: boolean;
  db: Firestore;
};

export type RunExportDeps = {
  user?: () => Promise<ExportUser | null>;
  viewer?: (db: Firestore, uid: string, isAdmin: boolean) => Promise<Viewer>;
  names?: (db: Firestore, uids: readonly string[]) => Promise<Map<string, string>>;
  record?: typeof recordDataExport;
  definitions?: Readonly<Record<string, ExportDefinition<never, never>>>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
};

export type ExportResult = { ok: true; table: ExportTable } | ExportRefusal;

function refuse(status: number, message: string): ExportRefusal {
  return { ok: false, status, message };
}

/**
 * The session user, with the admin claim re-read from Identity Platform.
 * Imported lazily so the pure parts of this module (and their tests) never
 * load next/headers or initialize firebase-admin.
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
  let isAdmin = tokenIsAdmin(decoded);
  if (isAdmin) {
    const record = await getAdminAuth().getUser(decoded.uid);
    isAdmin = record.customClaims?.role === "admin" && !record.disabled;
  }
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    name: (decoded.name as string | undefined) ?? null,
    isAdmin,
    db: getAdminDb(),
  };
}

async function defaultViewer(db: Firestore, uid: string, isAdmin: boolean) {
  const { loadViewer } = await import("@/lib/firebase/viewer");
  return loadViewer(db, uid, isAdmin);
}

async function defaultNames(db: Firestore, uids: readonly string[]) {
  const { loadUserNames } = await import("@/lib/firebase/user-names");
  return loadUserNames(db, uids);
}

export async function runExport(
  exportId: string,
  params: URLSearchParams,
  format: ExportFormat,
  deps: RunExportDeps = {},
): Promise<ExportResult> {
  // 1. Who — before anything about the page is looked at, so a non-admin
  //    learns nothing (not even which export ids exist).
  const user = await (deps.user ?? sessionUser)();
  if (!user) return refuse(401, NOT_SIGNED_IN);
  if (!user.isAdmin) return refuse(403, NOT_ADMIN);

  const definitions = deps.definitions ?? EXPORT_DEFINITIONS;
  const def = Object.hasOwn(definitions, exportId)
    ? (definitions[exportId] as unknown as ExportDefinition<unknown, unknown>)
    : undefined;
  if (!def) return refuse(404, UNKNOWN_EXPORT);

  // 2. What — the page's view, for this viewer.
  const parsed = def.parseParams(params);
  if (isRefusal(parsed)) return parsed;
  const viewer = await (deps.viewer ?? defaultViewer)(user.db, user.uid, user.isAdmin);
  const view = await def.load({ db: user.db, uid: user.uid, viewer }, parsed);
  if (isRefusal(view)) return view;

  if (view.rows.length > EXPORT_ROW_CAP) {
    return refuse(413, overCapMessage(view.rows.length));
  }

  // 8. Normalize. User ids the loader couldn't name come from /users.
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

  // 3. Provenance.
  const now = (deps.now ?? (() => new Date()))();
  const version = appVersion(deps.env);
  const provenance = provenanceLines({
    title: def.title,
    exportedBy: exporterLabel(user),
    now,
    filters: view.filters,
    rowCount: rows.length,
    version,
  });

  // 4. Audit, fail closed.
  try {
    await (deps.record ?? recordDataExport)(user.db, {
      actorUid: user.uid,
      exportId: def.id,
      teamId: view.teamId,
      format,
      filters: view.filters,
      rowCount: rows.length,
      appVersion: version,
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
      widths: def.columns.map((c) => c.width ?? 16),
      rows,
      provenance,
      fileName: exportFileName(def.id, view.fileNameParts, now),
    },
  };
}
