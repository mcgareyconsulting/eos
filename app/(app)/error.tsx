"use client";

import { useEffect } from "react";
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
  useEffect(() => {
    console.error("[app] route error:", error);
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
      </div>
    </div>
  );
}
