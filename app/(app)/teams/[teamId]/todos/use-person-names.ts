"use client";

import { useEffect, useMemo, useState } from "react";
import { loadPersonNames } from "./actions";

/**
 * Names for people off the page's roster (outside assignees, assigners from
 * other teams). `initial` is what the server already resolved; ids that
 * arrive later over a live listener are fetched once each. Misses are
 * remembered as "—" so they are not refetched forever.
 */
export function usePersonNames(
  ids: readonly string[],
  initial: Record<string, string>,
): (id: string) => string | undefined {
  const [extra, setExtra] = useState<Record<string, string>>({});
  const missing = useMemo(
    () =>
      [...new Set(ids)].filter(
        (id) => !!id && !(id in initial) && !(id in extra),
      ),
    [ids, initial, extra],
  );
  const missingKey = missing.join(",");

  useEffect(() => {
    if (!missingKey) return;
    const want = missingKey.split(",");
    let cancelled = false;
    loadPersonNames(want)
      .then((got) => {
        if (cancelled) return;
        const filled = Object.fromEntries(want.map((id) => [id, "—"]));
        setExtra((prev) => ({ ...prev, ...filled, ...got }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [missingKey]);

  return (id: string) => initial[id] ?? extra[id];
}
