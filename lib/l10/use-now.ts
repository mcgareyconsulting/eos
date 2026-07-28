"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

// One ticking clock for the whole meeting rail. The rail shows a total-elapsed
// readout and a segment countdown side by side; giving each its own interval
// meant two timers drifting a fraction of a second apart and re-rendering the
// panel twice a second. Callers derive every displayed value from this `now`.
//
// Returns null until the first client tick, and callers render a placeholder
// for that one frame. Seeding state with `Date.now()` instead would run it
// during SSR too, and the seconds had always moved on by the time the browser
// hydrated — every meeting load threw a hydration mismatch and regenerated
// the tree.
//
// useSyncExternalStore rather than useState + useEffect: the clock genuinely
// is an external, mutable source, and this is the one shape that can publish
// a value the instant it subscribes without setting state from an effect.
export function useNow(intervalMs = 1000): number | null {
  const nowRef = useRef(0);

  const subscribe = useCallback(
    (onChange: () => void) => {
      // Publish immediately so the clock doesn't sit blank for a full tick.
      nowRef.current = Date.now();
      onChange();
      const t = setInterval(() => {
        nowRef.current = Date.now();
        onChange();
      }, intervalMs);
      return () => clearInterval(t);
    },
    [intervalMs],
  );

  const now = useSyncExternalStore(
    subscribe,
    () => nowRef.current,
    () => 0, // server: no clock yet
  );

  return now === 0 ? null : now;
}
