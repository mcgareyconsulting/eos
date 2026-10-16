// HTTP framing for the export doors: the .xlsx route
// (app/api/export/[exportId]/route.ts), the print-token route
// (app/api/export/[exportId]/print-token/route.ts) and the print page's
// cross-site check. Kept out of the route files so it can be tested without a
// Next server.

import { writeXlsx, XLSX_MIME } from "./xlsx-writer";
import type { ExportResult } from "./run";
import type { ExportRefusal, ExportTable } from "./types";
import { printViewUrl } from "./urls";

const CHUNK = 64 * 1024;

/**
 * Same-origin check for the POST. The session cookie is SameSite=Lax, so a
 * cross-site POST already arrives without it; this refuses one that carries
 * an Origin from elsewhere anyway, so an export can only ever be started by
 * the app's own Export control.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) {
    // Browsers always send Origin on a fetch() POST; Sec-Fetch-Site is the
    // fallback signal for anything that didn't.
    const site = request.headers.get("sec-fetch-site");
    return site === null || site === "same-origin";
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Defense in depth for the print page's GET (the single-use token is the
 * gate): a navigation another site started. Sec-Fetch-Site is "same-origin"
 * when the Export control opens the tab and "none" when a person pastes the
 * URL; "same-site" / "cross-site" mean some other page sent the browser here.
 * Browsers that send no Sec-Fetch-Site fall through to the token check.
 */
export function isCrossSiteNavigation(headers: Pick<Headers, "get">): boolean {
  const site = headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}

/**
 * What the print page does with a result. Non-admins and unknown pages get
 * the 404 every admin-only surface gives (lib/firebase/teams.ts
 * requireAdmin), so export ids aren't enumerable; any other refusal (a dead
 * print link, an oversize view) is shown to the admin.
 */
export type PrintPageAction =
  | { kind: "login" }
  | { kind: "not_found" }
  | { kind: "message"; message: string }
  | { kind: "sheet"; table: ExportTable };

export function printPageAction(result: ExportResult): PrintPageAction {
  if (result.ok) return { kind: "sheet", table: result.table };
  if (result.status === 401) return { kind: "login" };
  if (result.status === 403 || result.status === 404) return { kind: "not_found" };
  return { kind: "message", message: result.message };
}

/** The print-token answer: the print view's URL, or the refusal as JSON. */
export function printTokenResponse(
  exportId: string,
  result: { ok: true; token: string } | ExportRefusal,
): Response {
  if (!result.ok) return refusalResponse(result.status, result.message);
  return Response.json({ url: printViewUrl(exportId, result.token) }, { headers: NO_STORE });
}

/** The bytes as a stream, in chunks. Memory only — nothing touches storage. */
export function bytesStream(buf: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= buf.length) {
        controller.close();
        return;
      }
      controller.enqueue(buf.subarray(offset, offset + CHUNK));
      offset += CHUNK;
    },
  });
}

const NO_STORE = { "Cache-Control": "no-store, private" };

export function refusalResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

/** An export result → the download, or the refusal as JSON. */
export function xlsxResponse(result: ExportResult): Response {
  if (!result.ok) return refusalResponse(result.status, result.message);
  const { table } = result;
  const buf = writeXlsx({
    sheetName: table.title,
    preamble: table.provenance,
    headers: table.headers,
    rows: table.rows,
    widths: table.widths,
  });
  return new Response(bytesStream(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": XLSX_MIME,
      "Content-Length": String(buf.byteLength),
      // fileName is built from ASCII slugs (lib/export/provenance.ts), so it
      // needs no escaping inside the quotes.
      "Content-Disposition": `attachment; filename="${table.fileName}.xlsx"`,
    },
  });
}
