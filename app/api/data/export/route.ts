import type { NextRequest } from "next/server";
import { requireOrgReader } from "@/lib/firebase/teams";
import { CSV_BOM, toCsv } from "@/lib/data-directory/csv";
import { loadData } from "@/lib/data-directory/load";
import {
  DATA_TYPE_BY_KEY,
  isDataTypeKey,
  type DataState,
} from "@/lib/data-directory/registry";

/**
 * CSV download for one /data type, honoring the page's active filters.
 *
 * One type per file on purpose: the columns are the type's own, and for a type
 * with an `importKind` they are exactly its EXPECTED_HEADERS set, so the file
 * this returns can be edited and fed straight back through /data/import.
 *
 * Uncapped — the table caps at 500 rows for legibility, but the export is the
 * thing people reach for precisely when 500 isn't enough.
 */

const STATES = new Set<string>(["active", "done", "archived", "cancelled"]);

/** requireOrgReader 404s by throwing; a redirect (no session) must still fly. */
function isNotFound(err: unknown): boolean {
  return /^NEXT_HTTP_ERROR_FALLBACK;404/.test(
    (err as { digest?: string })?.digest ?? "",
  );
}

export async function GET(request: NextRequest) {
  let db;
  try {
    ({ db } = await requireOrgReader());
  } catch (err) {
    if (isNotFound(err)) return new Response("Not found", { status: 404 });
    throw err;
  }

  const sp = request.nextUrl.searchParams;
  const type = sp.get("type") ?? "";
  if (!isDataTypeKey(type)) {
    return new Response("Pass ?type= one of: " + [...DATA_TYPE_BY_KEY.keys()].join(", "), {
      status: 400,
    });
  }

  const state = sp.get("state");
  const data = await loadData(db, {
    type,
    teamId: sp.get("team") || null,
    ownerId: sp.get("owner") || null,
    state: state && STATES.has(state) ? (state as DataState) : null,
    quarter: type === "rocks" ? sp.get("quarter") || null : null,
    q: sp.get("q") || null,
  });

  const bucket = data.byType[0];
  const headers = bucket.def.columns.map((c) => c.header);
  const rows = bucket.entries.map(({ doc }) =>
    Object.fromEntries(
      bucket.def.columns.map((c) => [c.header, c.get(doc, data.ctx)]),
    ),
  );

  const filename = `eos-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(CSV_BOM + toCsv(headers, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // A filtered org-wide extract should not sit in any shared cache.
      "cache-control": "no-store",
    },
  });
}
