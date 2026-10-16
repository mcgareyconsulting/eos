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
// Dates and datetimes become `ExportDateCell`s: a real spreadsheet date (an
// Excel serial the .xlsx writer formats as yyyy-mm-dd / yyyy-mm-dd hh:mm)
// plus the text the print view shows. A datetime's serial is its Mountain
// wall-clock time, so the spreadsheet and the paper agree.

import { richTextToPlain } from "@/lib/rich-text";
import { APP_TIME_ZONE } from "@/lib/time-zone";
import { ownerLabel } from "@/lib/user-name";
import type { ColumnKind, ExportCell, ExportDateCell } from "./types";

/** The zone every export reads instants in: the bank's clock. */
export const EXPORT_TIME_ZONE = APP_TIME_ZONE;
/** How labels name that zone; the MDT/MST abbreviation comes from Intl. */
export const EXPORT_TIME_ZONE_LABEL = "Mountain Time";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

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
  timeZoneName: "short",
});

function mountainParts(d: Date): Record<string, string> {
  return Object.fromEntries(partsFormatter.formatToParts(d).map((p) => [p.type, p.value]));
}

/** `YYYY-MM-DD` — the Mountain calendar day of an instant. */
export function formatMountainDate(d: Date): string {
  const p = mountainParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `YYYY-MM-DD HH:mm MDT` (or MST) — an instant in Mountain time. */
export function formatMountainDateTime(d: Date): string {
  const p = mountainParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`;
}

// Excel's day 0 is 1899-12-30 for every date from 1900-03-01 on (the 1900
// leap-year bug only shifts serials below 61, which no real export holds).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
/** 1900-03-01: from here on a serial means the same day in every spreadsheet. */
const FIRST_SAFE_SERIAL = 61;

/** The Excel serial of a wall-clock date and time (the cell itself has no zone). */
export function excelSerial(y: number, m: number, d: number, hh = 0, mm = 0): number {
  return (Date.UTC(y, m - 1, d, hh, mm) - EXCEL_EPOCH_MS) / DAY_MS;
}

function dateCell(kind: ExportDateCell["kind"], serial: number, text: string): ExportCell {
  // Outside what a spreadsheet dates reliably: keep the text.
  if (!Number.isFinite(serial) || serial < FIRST_SAFE_SERIAL) return text;
  return { kind, serial, text };
}

/** A calendar day `YYYY-MM-DD` → a date cell. */
function dayCell(day: string): ExportCell {
  const m = DAY_RE.exec(day);
  if (!m) return day;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  // 2026-02-30 is not a day; don't let Date.UTC roll it into March.
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return day;
  return dateCell("date", excelSerial(y, mo, d), day);
}

/** A cell's display text — what the print view shows. */
export function cellText(cell: ExportCell): string {
  return typeof cell === "object" ? cell.text : String(cell);
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
      if (typeof raw === "string" && DAY_RE.test(raw)) return dayCell(raw);
      const d = toDate(raw);
      return d ? dayCell(formatMountainDate(d)) : "";
    }
    case "datetime": {
      const d = toDate(raw);
      if (!d) return "";
      const p = mountainParts(d);
      return dateCell(
        "datetime",
        excelSerial(
          Number(p.year),
          Number(p.month),
          Number(p.day),
          Number(p.hour),
          Number(p.minute),
        ),
        `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`,
      );
    }
    case "text":
      if (raw == null) return "";
      return String(raw).trim();
  }
}
