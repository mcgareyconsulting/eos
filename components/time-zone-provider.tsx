"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import {
  APP_TIME_ZONE,
  TIME_ZONE_COOKIE,
  normalizeTimeZone,
} from "@/lib/time-zone";

const ONE_YEAR_S = 365 * 24 * 60 * 60;

const TimeZoneContext = createContext<string>(APP_TIME_ZONE);

// The system zone only changes with a reload in practice; nothing to watch.
function subscribeNever(): () => void {
  return () => {};
}

// The browser's IANA zone, or null if the engine reports none it accepts.
// A string, so useSyncExternalStore's snapshot is stable between calls.
function readBrowserZone(): string | null {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

function readZoneCookie(): string | null {
  try {
    const prefix = `${TIME_ZONE_COOKIE}=`;
    const hit = document.cookie
      .split("; ")
      .find((c) => c.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
  } catch {
    return null;
  }
}

// True when the cookie now holds `zone`. A valid zone is only
// `[A-Za-z0-9_+-/]`, so it is a safe raw cookie value.
function writeZoneCookie(zone: string): boolean {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${TIME_ZONE_COOKIE}=${zone}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax${secure}`;
    return readZoneCookie() === zone;
  } catch {
    // Cookies blocked: the server keeps falling back to APP_TIME_ZONE.
    return false;
  }
}

/**
 * The zone client components render due dates in (lib/time-zone.ts).
 *
 * Hydration renders with `initialZone` — what the server resolved from the
 * `tz` cookie — so server HTML and the first client render agree (the
 * server snapshot of useSyncExternalStore). React then re-renders with the
 * browser's own zone if it differs. The browser zone is also written to the
 * cookie, and when that changes the cookie (first visit, travel, a changed
 * system zone) the route refreshes so server-rendered dates follow too.
 */
export function TimeZoneProvider({
  initialZone,
  children,
}: {
  initialZone: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const browserZone = useSyncExternalStore(
    subscribeNever,
    readBrowserZone,
    () => null,
  );
  const zone = browserZone ?? initialZone;

  useEffect(() => {
    if (!browserZone) return;
    // Refresh server-rendered dates only when the cookie actually changes —
    // not on every mount where the server spelled the same zone differently
    // (engines can canonicalize aliases differently), and never in a loop.
    if (readZoneCookie() !== browserZone && writeZoneCookie(browserZone)) {
      router.refresh();
    }
  }, [browserZone, router]);

  return (
    <TimeZoneContext.Provider value={zone}>{children}</TimeZoneContext.Provider>
  );
}

/** The viewer's zone for rendering due dates (APP_TIME_ZONE outside a provider). */
export function useTimeZone(): string {
  return useContext(TimeZoneContext);
}
