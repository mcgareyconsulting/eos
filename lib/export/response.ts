// HTTP framing for the export route (app/api/export/[exportId]/route.ts).
// Kept out of the route file so it can be tested without a Next server.

import { csvBytes, CSV_MIME } from "./csv";
import type { ExportResult } from "./run";

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

/** An export result → the CSV download, or the refusal as JSON. */
export function csvResponse(result: ExportResult): Response {
  if (!result.ok) return refusalResponse(result.status, result.message);
  const { table } = result;
  const bytes = csvBytes({ headers: table.headers, rows: table.rows });
  return new Response(bytesStream(bytes), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": CSV_MIME,
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      // fileName is built from ASCII slugs (lib/export/provenance.ts), so it
      // needs no escaping inside the quotes.
      "Content-Disposition": `attachment; filename="${table.fileName}"`,
    },
  });
}
