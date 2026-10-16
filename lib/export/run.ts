// The export core (feedback row 55, docs/EXPORT.md). Both doors — the .xlsx
// route (app/api/export/[exportId]/route.ts) and the print view
// (app/(print)/print/[exportId]/page.tsx, entered through a token minted by
// app/api/export/[exportId]/print-token/route.ts) — go through this module,
// so every guardrail below holds for every page and every format:
//
//   1. Admin only, re-checked here on every request: the session must verify
//      AND the account must hold the admin claim right now (a live Auth read,
//      not just the claim baked into a cookie up to 25 hours ago). The Export
//      control being hidden from non-admins is a convenience, not the gate.
//   2. Exactly the page's view: the definition parses the page's own query
//      parameters and loads with the page's own queries and visibility
//      predicate, for this viewer — never more than the UI shows.
//   3. Provenance header (lib/export/provenance.ts), times in Mountain time.
//   4. One audit_log row per export, written BEFORE the file is released;
//      if it can't be written, nothing is sent (lib/export/audit.ts). Every
//      signed-in attempt the core refuses is audited too, outcome "refused".
//   5. Formula-injection protection — in the .xlsx writer, for every cell.
//   6. Nothing is persisted: the table lives in this request's memory and
//      goes straight into the response. (The print token is a two-minute,
//      single-use pointer to the view, never its rows — print-token.ts.)
//   8. Values normalized by column kind; a row cap refuses an oversize view
//      with a message to narrow it (it never silently truncates — a partial
//      file handed to an auditor is worse than none). Loaders honor it early
//      (lib/export/cap.ts); the core re-checks before resolving names.
//
// The print view is never a state-changing GET: it renders only for a
// single-use token that a same-origin POST minted for this admin, this
// export and this view (lib/export/print-token.ts).
//
// Test seam: production callers never pass `deps`.

import type { Firestore } from "firebase-admin/firestore";
import type { Viewer } from "@/lib/access/types";
import { recordDataExport } from "./audit";
import { EXPORT_ROW_CAP, overCapRefusal } from "./cap";
import { normalizeCell } from "./normalize";
import { consumePrintToken, mintPrintToken } from "./print-token";
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
  type ExportFilterLine,
  type ExportFormat,
  type ExportRefusal,
  type ExportTable,
} from "./types";

export { EXPORT_ROW_CAP, overCapMessage } from "./cap";

export const NOT_SIGNED_IN = "Your session has ended. Sign in again to export.";
export const NOT_ADMIN = "Only admins can export data.";
export const UNKNOWN_EXPORT = "This page has no export.";
export const AUDIT_FAILED =
  "The export could not be recorded in the audit trail, so it was not sent. Try again.";
export const PRINT_LINK_INVALID =
  "This print link has expired or was already used. Close this tab and choose " +
  "Print / Save as PDF on the page again.";
export const PRINT_START_FAILED = "The print view could not be started. Try again.";

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
  mintToken?: typeof mintPrintToken;
  consumeToken?: typeof consumePrintToken;
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
    case 403:
      return "not_admin";
    case 404:
      return "not_found";
    case 410:
      return "print_link_invalid";
    case 413:
      return "over_cap";
    default:
      return "refused";
  }
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

/** One request, from the moment we know who is asking. */
type Attempt = {
  user: ExportUser;
  exportId: string;
  format: ExportFormat;
  deps: RunExportDeps;
  version: string;
  /** The view's query string as requested, for refused rows; null when unknown. */
  query: string | null;
};

/**
 * Audit a refused attempt (outcome "refused"), then hand the refusal back.
 * Best effort: the request is refused either way, so a failed write is
 * logged rather than turned into a different answer.
 */
async function refused(
  a: Attempt,
  refusal: ExportRefusal,
  known: { filters?: readonly ExportFilterLine[]; teamId?: string | null; rowCount?: number } = {},
): Promise<ExportRefusal> {
  try {
    await (a.deps.record ?? recordDataExport)(a.user.db, {
      actorUid: a.user.uid,
      exportId: a.exportId,
      teamId: known.teamId ?? null,
      format: a.format,
      filters: known.filters ?? [],
      rowCount: known.rowCount ?? null,
      appVersion: a.version,
      outcome: "refused",
      reason: refusalReason(refusal),
      httpStatus: refusal.status,
      query: a.query,
    });
  } catch (err) {
    console.error("data_export refusal audit write failed", a.exportId, err);
  }
  return refusal;
}

type Begun =
  | { ok: true; attempt: Attempt; def: ExportDefinition<unknown, unknown> }
  | ExportRefusal;

/**
 * Who, then which page — before anything about the page is looked at, so a
 * non-admin learns nothing (not even which export ids exist).
 */
async function begin(
  exportId: string,
  format: ExportFormat,
  query: string | null,
  deps: RunExportDeps,
): Promise<Begun> {
  const user = await (deps.user ?? sessionUser)();
  if (!user) return refuse(401, NOT_SIGNED_IN);
  const attempt: Attempt = {
    user,
    exportId,
    format,
    deps,
    version: appVersion(deps.env),
    query,
  };
  if (!user.isAdmin) return refused(attempt, refuse(403, NOT_ADMIN, "not_admin"));

  const definitions = deps.definitions ?? EXPORT_DEFINITIONS;
  const def = Object.hasOwn(definitions, exportId)
    ? (definitions[exportId] as unknown as ExportDefinition<unknown, unknown>)
    : undefined;
  if (!def) return refused(attempt, refuse(404, UNKNOWN_EXPORT, "unknown_export"));
  return { ok: true, attempt, def };
}

/** Steps 2 → 4 for an admin and a known page: the view, the table, the audit row. */
async function produce(
  a: Attempt,
  def: ExportDefinition<unknown, unknown>,
  params: URLSearchParams,
): Promise<ExportResult> {
  const { user, deps } = a;

  // 2. What — the page's view, for this viewer.
  const parsed = def.parseParams(params);
  if (isRefusal(parsed)) return refused(a, parsed);
  const viewer = await (deps.viewer ?? defaultViewer)(user.db, user.uid, user.isAdmin);
  const view = await def.load({ db: user.db, uid: user.uid, viewer }, parsed);
  if (isRefusal(view)) return refused(a, view);

  // 8. The cap, before any name lookup. Loaders should already have refused
  //    (lib/export/cap.ts); this catches one that didn't.
  if (view.rows.length > EXPORT_ROW_CAP) {
    return refused(a, overCapRefusal(view.rows.length), {
      filters: view.filters,
      teamId: view.teamId,
      rowCount: view.rows.length,
    });
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
  const provenance = provenanceLines({
    title: def.title,
    exportedBy: exporterLabel(user),
    now,
    filters: view.filters,
    rowCount: rows.length,
    version: a.version,
  });

  // 4. Audit, fail closed.
  try {
    await (deps.record ?? recordDataExport)(user.db, {
      actorUid: user.uid,
      exportId: def.id,
      teamId: view.teamId,
      format: a.format,
      filters: view.filters,
      rowCount: rows.length,
      appVersion: a.version,
      outcome: "ok",
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

/** The .xlsx door: the view named by `params`, as a table. */
export async function runExport(
  exportId: string,
  params: URLSearchParams,
  format: ExportFormat,
  deps: RunExportDeps = {},
): Promise<ExportResult> {
  const begun = await begin(exportId, format, params.toString(), deps);
  if (!begun.ok) return begun;
  return produce(begun.attempt, begun.def, params);
}

/**
 * The print door, step one (a same-origin POST from the Export control):
 * check the admin, the page and the parameters, then mint a single-use token
 * bound to all three. Nothing is read or exported yet — the export, and its
 * "ok" audit row, happen when the print view spends the token.
 */
export async function startPrintExport(
  exportId: string,
  params: URLSearchParams,
  deps: RunExportDeps = {},
): Promise<{ ok: true; token: string } | ExportRefusal> {
  const begun = await begin(exportId, "print", params.toString(), deps);
  if (!begun.ok) return begun;
  const { attempt, def } = begun;
  const parsed = def.parseParams(params);
  if (isRefusal(parsed)) return refused(attempt, parsed);
  try {
    const token = await (deps.mintToken ?? mintPrintToken)(attempt.user.db, {
      uid: attempt.user.uid,
      exportId: def.id,
      params,
      now: (deps.now ?? (() => new Date()))(),
    });
    return { ok: true, token };
  } catch (err) {
    console.error("print token mint failed", def.id, err);
    return refuse(500, PRINT_START_FAILED);
  }
}

/**
 * The print door, step two (the print page's GET): spend the token, then
 * export the view it was minted for. `crossSite` is the page's own
 * Sec-Fetch-Site check — defense in depth; the token is the real gate.
 */
export async function runPrintExport(
  exportId: string,
  token: string | null,
  request: { crossSite: boolean },
  deps: RunExportDeps = {},
): Promise<ExportResult> {
  // The query isn't known until the token is spent, and the token itself is
  // never written to the audit trail.
  const begun = await begin(exportId, "print", null, deps);
  if (!begun.ok) return begun;
  const { attempt, def } = begun;

  if (request.crossSite) {
    // Don't spend the token: a cross-site page shouldn't be able to burn it.
    return refused(attempt, refuse(410, PRINT_LINK_INVALID, "cross_site"));
  }
  const spent = await (deps.consumeToken ?? consumePrintToken)(attempt.user.db, token, {
    uid: attempt.user.uid,
    exportId: def.id,
    now: (deps.now ?? (() => new Date()))(),
  });
  if (!spent.ok) return refused(attempt, refuse(410, PRINT_LINK_INVALID, spent.reason));

  return produce({ ...attempt, query: spent.params.toString() }, def, spent.params);
}
