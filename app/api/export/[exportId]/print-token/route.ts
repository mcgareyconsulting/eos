import type { NextRequest } from "next/server";
import { startPrintExport } from "@/lib/export/run";
import { isSameOrigin, printTokenResponse, refusalResponse } from "@/lib/export/response";

/**
 * Admin data export, print view — step one (feedback row 55; docs/EXPORT.md).
 *
 *   POST /api/export/{exportId}/print-token?<the page's own query parameters>
 *     → { url: "/print/{exportId}?t=<single-use token>" }
 *
 * The print view renders (and audits) an export, so it must not be
 * reachable by a plain GET a cross-site link could trigger. This same-origin
 * POST checks the admin, the page and the parameters, and mints a two-minute,
 * single-use token bound to all three (lib/export/print-token.ts); the print
 * page renders only for that token.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ exportId: string }> },
) {
  if (!isSameOrigin(request)) return refusalResponse(403, "Cross-site export refused.");
  const { exportId } = await params;
  const result = await startPrintExport(exportId, request.nextUrl.searchParams);
  return printTokenResponse(exportId, result);
}
