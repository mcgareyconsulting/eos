import type { NextRequest } from "next/server";
import { runExport } from "@/lib/export/run";
import { isSameOrigin, refusalResponse, xlsxResponse } from "@/lib/export/response";

/**
 * Admin data export, .xlsx (feedback row 55; docs/EXPORT.md).
 *
 *   POST /api/export/{exportId}?<the page's own query parameters>
 *
 * POST, not GET: the export writes an audit row, so it must not be startable
 * by a cross-site link or a prefetch. The admin check, the view, the row cap,
 * provenance and the audit row are all lib/export/run.ts — this file only
 * frames the answer. The workbook is built in memory and streamed back; it is
 * never written to disk or storage.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ exportId: string }> },
) {
  if (!isSameOrigin(request)) return refusalResponse(403, "Cross-site export refused.");
  const { exportId } = await params;
  const result = await runExport(exportId, request.nextUrl.searchParams, "xlsx");
  return xlsxResponse(result);
}
