// Value normalization for exports (docs/EXPORT.md). Pure: the column kinds
// of lib/export/types.ts → the one value a cell holds, so a date, a name or
// a description reads the same in every export.
//
// Times are the bank's clock — APP_TIME_ZONE (America/Denver, Mountain
// time) from lib/time-zone.ts — whatever zone the server runs in (Cloud Run
// is UTC). A calendar-day field stored as `YYYY-MM-DD` (due dates) is a day,
// not an instant, and passes through untouched — the same rule lib/dates.ts
// formatDateOnly follows.
//
// Dates and datetimes are TEXT in the file — `YYYY-MM-DD` and
// `YYYY-MM-DD HH:mm` — with no zone in the cell (Daniel 2026-10-16). Excel
// still recognizes both as dates when it opens the CSV, and they sort
// correctly as plain text either way.

import { richTextToPlain } from "@/lib/rich-text";
import { APP_TIME_ZONE } from "@/lib/time-zone";
import { ownerLabel } from "@/lib/user-name";
import type { ColumnKind, ExportCell } from "./types";

/** The zone every export reads instants in: the bank's clock. */
export const EXPORT_TIME_ZONE = APP_TIME_ZONE;

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

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EXPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function mountainParts(d: Date): Record<string, string> {
  return Object.fromEntries(partsFormatter.formatToParts(d).map((p) => [p.type, p.value]));
}

/** `YYYY-MM-DD` — the Mountain calendar day of an instant. */
export function formatMountainDate(d: Date): string {
  const p = mountainParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `YYYY-MM-DD HH:mm` — an instant in Mountain time (no zone text). */
export function formatMountainDateTime(d: Date): string {
  const p = mountainParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
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
      return d ? formatMountainDate(d) : "";
    }
    case "datetime": {
      const d = toDate(raw);
      return d ? formatMountainDateTime(d) : "";
    }
    case "text":
      if (raw == null) return "";
      return String(raw).trim();
  }
}
