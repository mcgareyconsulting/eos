"use client";

import { useSyncExternalStore } from "react";

// Detects "hydrated on the client" without effect-driven state: the server
// snapshot is false, the client snapshot is true, so the first client render
// after hydration flips exactly once.
//
// Use this instead of a `mounted` flag set from an effect — a setState in an
// effect body costs an extra render pass, and the compiler rejects it.
const emptySubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
