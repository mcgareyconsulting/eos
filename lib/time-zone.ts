// Time zones: the bank-wide clock, and "what calendar day is it" in any zone.
//
// Two clocks, on purpose:
//
// - APP_TIME_ZONE is the bank's clock. Anything that has to agree for every
//   viewer — scheduled jobs, export timestamps — reads the date in this zone.
//   Other modules import it by this name from this path; keep both.
// - Screen display (the "Today" label, due tones, "in 3d" labels) follows the
//   VIEWER's zone, so "today" means the viewer's today. The browser reports
//   its zone into the `tz` cookie (components/time-zone-provider.tsx); server
//   components read it back through lib/viewer-time-zone.ts and fall back to
//   APP_TIME_ZONE when it is missing or not a real zone.
//
// Pure: no Next.js imports, so client components and tests can use it.

/** The bank's clock (High Plains Bank is on Mountain time). */
export const APP_TIME_ZONE = "America/Denver";

/** Cookie the browser writes its IANA zone into. Not sensitive. */
export const TIME_ZONE_COOKIE = "tz";

// IANA names are letters, digits and `_ + - /` ("America/Denver",
// "Etc/GMT+7", "UTC"). Rejecting anything else up front keeps junk out of the
// Intl constructor and means a valid zone is always a safe cookie value.
const ZONE_SHAPE = /^[A-Za-z0-9_+\-/]{1,64}$/;

// Keyed by the CANONICAL zone name only. Intl accepts any letter case
// ("aMeRiCa/dEnVeR"), so caching raw cookie values would let one client grow
// this module-level map without bound; a non-canonical spelling just builds a
// throwaway formatter instead.
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dayFormatters.get(timeZone);
  if (cached) return cached;
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const canonical = f.resolvedOptions().timeZone;
  if (canonical === timeZone) dayFormatters.set(canonical, f);
  return f;
}

/** Test hook: how many formatters are cached. */
export function cachedFormatterCountForTesting(): number {
  return dayFormatters.size;
}

/**
 * The canonical zone name when `value` is a zone Intl accepts, else null.
 * Never throws — this is what stands between a hand-edited cookie and a
 * crashed render.
 */
export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !ZONE_SHAPE.test(value)) return null;
  try {
    return dayFormatter(value).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidTimeZone(value: unknown): value is string {
  return normalizeTimeZone(value) !== null;
}

/** `value` when it is a real zone, otherwise the bank's clock. */
export function resolveTimeZone(value: unknown): string {
  return normalizeTimeZone(value) ?? APP_TIME_ZONE;
}

/** The calendar date of instant `at` in `timeZone`, as `YYYY-MM-DD`. */
export function calendarDateIn(
  at: Date,
  timeZone: string = APP_TIME_ZONE,
): string {
  const parts = dayFormatter(resolveTimeZone(timeZone)).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// `YYYY-MM-DD` → its day number (UTC midnight), so a difference of two is a
// whole number of calendar days with no DST hour to round away.
function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/**
 * Whole calendar days from "today in `timeZone`" (at instant `from`) to the
 * date-only `due`; negative when overdue.
 */
export function daysUntilIn(
  due: string,
  from: Date = new Date(),
  timeZone: string = APP_TIME_ZONE,
): number {
  return dayNumber(due) - dayNumber(calendarDateIn(from, timeZone));
}
