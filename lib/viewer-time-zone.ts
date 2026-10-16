import { cookies } from "next/headers";
import { TIME_ZONE_COOKIE, resolveTimeZone } from "@/lib/time-zone";

/**
 * The viewer's time zone for server-rendered dates: the `tz` cookie the
 * browser wrote (components/time-zone-provider.tsx), or APP_TIME_ZONE when it
 * is missing or not a real zone. Server Components only — `cookies()` makes
 * the route dynamic, which every signed-in route already is.
 */
export async function getViewerTimeZone(): Promise<string> {
  try {
    const store = await cookies();
    return resolveTimeZone(store.get(TIME_ZONE_COOKIE)?.value);
  } catch {
    // Outside a request (build, tests): the bank's clock.
    return resolveTimeZone(undefined);
  }
}
