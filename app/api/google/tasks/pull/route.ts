import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import {
  googleOAuthConfigured,
  googleTasksPullSecret,
  pullCompletionsForAllConnected,
} from "@/lib/google/tasks";

/**
 * Background Google → EOS completion sweep.
 *
 * Invoked by Cloud Scheduler (or curl) with:
 *   Authorization: Bearer $GOOGLE_TASKS_PULL_SECRET
 *
 * When the secret env is unset, the route is disabled (503) so an
 * unconfigured deploy can't be probed as an open endpoint.
 */
export async function POST(request: NextRequest) {
  const secret = googleTasksPullSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "GOOGLE_TASKS_PULL_SECRET not configured" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!googleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth not configured", users: 0, updated: 0 },
      { status: 503 },
    );
  }

  const result = await pullCompletionsForAllConnected();
  // So the next navigation/reload of To-Dos/Home picks up completed_at writes.
  // Open tabs still need a browser refresh (standalone To-Dos is not live).
  if (result.updated > 0) {
    revalidatePath("/home");
    revalidatePath("/teams", "layout");
  }
  return NextResponse.json({ ok: true, ...result });
}

// Allow GET with the same auth for easy health checks from Scheduler HTTP
// targets that only support GET — still requires the secret.
export async function GET(request: NextRequest) {
  return POST(request);
}
