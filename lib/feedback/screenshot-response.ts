// The feedback tracker's screenshot response (access list only), kept out of the route file
// (app/api/admin/feedback/screenshots/[name]/route.ts) so it can be tested
// without a Next server. Server only (reads the file system).
//
// Every refusal is the same bare 404 — no session, not on the tracker's
// access list and not an org admin, a bad name, a name not on the file
// allow-list, a missing file — so the route says nothing about which
// screenshots exist to anyone who may not see them.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { canUseFeedbackTracker, type FeedbackDeps } from "@/lib/firebase/feedback-access";
import { servableFeedbackScreenshot } from "./screenshots";

export type ScreenshotDeps = FeedbackDeps & {
  /** Reads one allow-listed file by name; defaults to readScreenshotFile. */
  readFile?: (file: string) => Promise<Uint8Array>;
};

/**
 * The file on disk. The directory is spelled out as literals (it is
 * FEEDBACK_SCREENSHOT_DIR) so the build's file tracing can scope this read
 * to that folder instead of tracing the whole project; next.config.ts
 * `outputFileTracingIncludes` lists the PNGs themselves. process.cwd() is
 * the project root locally and the standalone server's directory in the
 * image (where the traced files land at the same relative path).
 */
export function readScreenshotFile(file: string): Promise<Uint8Array> {
  return readFile(path.join(process.cwd(), "docs", "feedback", "screenshots", file));
}

const BASE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function notFoundResponse(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function viewerMayView(deps: ScreenshotDeps): Promise<boolean> {
  try {
    // The tracker's own gate (lib/firebase/feedback-access.ts): verified
    // session, then the email on the access list. Fails closed.
    return await canUseFeedbackTracker(deps.user ? { user: deps.user } : undefined);
  } catch {
    // No session: requireFirebaseUser redirects to /login. For an image the
    // answer is the same 404 an unlisted person gets, not a redirect.
    return false;
  }
}

export async function feedbackScreenshotResponse(
  name: string,
  deps: ScreenshotDeps = {},
): Promise<Response> {
  if (!(await viewerMayView(deps))) return notFoundResponse();
  const file = servableFeedbackScreenshot(name);
  if (!file) return notFoundResponse();
  // `file` is a literal from the allow-list, not the request's text.
  let bytes: Uint8Array;
  try {
    bytes = await (deps.readFile ?? readScreenshotFile)(file);
  } catch {
    return notFoundResponse();
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
