// Value normalization for exports (docs/EXPORT.md). Pure: the column kinds
// of lib/export/types.ts → the one string (or number) a cell holds, so a
// date, a name or a description reads the same in every export.
//
// Times are America/Chicago, the bank's local time, whatever zone the server
// runs in (Cloud Run is UTC). A calendar-day field stored as `YYYY-MM-DD`
// (due dates) is a day, not an instant, and passes through untouched — the
// same rule lib/dates.ts formatDateOnly follows.

import { richTextToPlain } from "@/lib/rich-text";
import { ownerLabel } from "@/lib/user-name";
import type { ColumnKind, ExportCell } from "./types";

export const EXPORT_TIME_ZONE = "America/Chicago";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Timestamp (admin or client SDK), Date, millis or ISO string → Date. */
export function toDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  let d: Date | null = null;
  if (v instanceof Date) d = v;
  else if (typeof v === "number") d = new Date(v);
  else if (typeof v === "string") d = new Date(v);
  else if (typeof (v as { toDate?: unknown }).toDate === "function") {
    d = (v as { toDate: () => Date }).toDate();
  } else if (typeof (v as { toMillis?: unknown }).toMillis === "function") {
    d = new Date((v as { toMillis: () => number }).toMillis());
  }
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function chicagoParts(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EXPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(d);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** `YYYY-MM-DD` — the Chicago calendar day of an instant. */
export function formatChicagoDate(d: Date): string {
  const p = chicagoParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `YYYY-MM-DD HH:mm CDT` (or CST) — an instant in Chicago time. */
export function formatChicagoDateTime(d: Date): string {
  const p = chicagoParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`;
}

/**
 * One cell. `nameOf` answers `user` columns; an id it can't resolve shows
 * "—" and a missing owner "Unassigned", exactly as the pages render them
 * (lib/user-name.ts ownerLabel).
 */
export function normalizeCell(
  kind: ColumnKind,
  raw: unknown,
  nameOf: (uid: string) => string | null | undefined,
): ExportCell {
  switch (kind) {
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? raw : "";
    case "boolean":
      return raw === true ? "Yes" : "No";
    case "user":
      return ownerLabel(typeof raw === "string" ? raw : null, nameOf);
    case "richtext":
      return typeof raw === "string" ? richTextToPlain(raw) : "";
    case "date": {
      if (typeof raw === "string" && DAY_RE.test(raw)) return raw;
      const d = toDate(raw);
      return d ? formatChicagoDate(d) : "";
    }
    case "datetime": {
      const d = toDate(raw);
      return d ? formatChicagoDateTime(d) : "";
    }
    case "text":
      if (raw == null) return "";
      return String(raw).trim();
  }
}
