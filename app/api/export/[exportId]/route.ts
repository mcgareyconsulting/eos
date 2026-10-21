import type { NextRequest } from "next/server";
import { runExport } from "@/lib/export/run";
import { csvResponse, isSameOrigin, refusalResponse } from "@/lib/export/response";

/**
 * Data export, CSV (feedback row 55; docs/EXPORT.md). Open to every
 * signed-in user, scoped to what the page shows them.
 *
 *   POST /api/export/{exportId}?<the page's own query parameters>
 *
 * POST, not GET: the export writes an audit row, so it must not be startable
 * by a cross-site link or a prefetch. The live account check, the page's
 * access rule, the view, the row cap and the audit row are all
 * lib/export/run.ts — this file only frames the answer. The CSV is built in
 * memory and streamed back; it is never written to disk or storage.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ exportId: string }> },
) {
  if (!isSameOrigin(request)) return refusalResponse(403, "Cross-site export refused.");
  const { exportId } = await params;
  const result = await runExport(exportId, request.nextUrl.searchParams, "csv");
  return csvResponse(result);
}
