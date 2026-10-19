import { feedbackScreenshotResponse } from "@/lib/feedback/screenshot-response";

/**
 * Feedback tracker screenshots (ROADMAP N73), org admins only.
 *
 *   GET /api/admin/feedback/screenshots/row02.png
 *
 * The admin check, the name allow-list and the file read are all
 * lib/feedback/screenshot-response.ts; every refusal is a 404. The files ship
 * in the standalone build via next.config.ts `outputFileTracingIncludes`
 * (they are not under public/, on purpose).
 *
 * proxy.ts does not run for this path (its matcher skips anything ending in
 * .png), so this handler's own session check is the only gate — which is why
 * it verifies the session itself rather than trusting the proxy.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  return feedbackScreenshotResponse(name);
}
