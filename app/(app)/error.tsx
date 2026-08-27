"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

// Route-level error boundary for the app shell. Without this, any server
// action or render error (a deleted meeting, a transient Firestore hiccup)
// replaced the whole screen with Next's unstyled production error page —
// with no way back mid-demo.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reported, setReported] = useState(false);

  useEffect(() => {
    console.error("[app] route error:", error);

    // Also send it somewhere we can actually read. console.error alone lives
    // and dies in the user's browser: when the client hit this screen on the
    // Scorecard on 2026-08-19, nothing about it existed on our side. See
    // app/api/client-error/route.ts.
    const controller = new AbortController();
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        digest: error.digest,
        message: error.message,
        stack: error.stack,
        path: window.location.pathname + window.location.search,
        // Next stamps the running build onto <html> when deploymentId is
        // configured (next.config.ts). A mismatch against the serving
        // revision is the signature of a deploy landing under an open tab.
        deploymentId: document.documentElement.dataset.dplId,
      }),
      signal: controller.signal,
      keepalive: true,
    })
      .then(() => setReported(true))
      .catch(() => {
        // The report failing is not worth a second error screen.
      });

    return () => controller.abort();
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-zinc-300 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <h1 className="mt-3 text-base font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          The page hit an unexpected error. Your meeting data is safe — try
          again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md bg-hpb-blue px-4 py-1.5 text-sm font-medium text-white hover:brightness-110"
        >
          Try again
        </button>
        {/* The digest is the key that joins this screen to the server-side
            stack in Cloud Logging. Showing it turns "it broke" in a bug
            report into something we can look up. */}
        {error.digest ? (
          <p className="mt-4 select-all font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
            {error.digest}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-600">
          {reported
            ? "This error was reported automatically."
            : "If it keeps happening, send us this screen."}
        </p>
      </div>
    </div>
  );
}
