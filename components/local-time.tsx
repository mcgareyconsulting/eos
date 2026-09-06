"use client";

import { useHydrated } from "@/lib/use-hydrated";

// Client-local timestamp text. The server runs in UTC (no TZ set in Cloud
// Run), so anything formatted server-side shows the wrong wall-clock time to
// the viewer. This renders a deterministic fallback in the server HTML —
// hydration always matches — then swaps in the viewer's locale/timezone.
export function LocalTime({
  ms,
  options,
  fallback,
}: {
  ms: number | null;
  options: Intl.DateTimeFormatOptions;
  /** Shown before hydration (and when ms is null). Defaults to a
   *  UTC-formatted string, which server and client compute identically. */
  fallback?: string;
}) {
  const hydrated = useHydrated();
  if (ms == null) return <>{fallback ?? "—"}</>;
  if (!hydrated) {
    return (
      <>
        {fallback ??
          new Date(ms).toLocaleString("en-US", { ...options, timeZone: "UTC" })}
      </>
    );
  }
  return <>{new Date(ms).toLocaleString(undefined, options)}</>;
}
