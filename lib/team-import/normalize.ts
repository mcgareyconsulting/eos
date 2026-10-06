// Small per-row normalizers shared by the kind importers.

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { cell, parseDateOnly } from "../csv-import";
import { requireMaxLength } from "../text-limits";
import type { ImportKind } from "../team-import-types";
import type { PreviewCollector } from "./owners";

export function isArchived(row: Record<string, string>, headers: string[]): boolean {
  const archivedOn = cell(row, headers, "Archived Date", "Archived On", "Archived");
  if (archivedOn) return true;
  return /archiv|deleted/i.test(cell(row, headers, "Status"));
}

export function isStaleCompletion(completedOn: string | null, since: string | null): boolean {
  return !!since && !!completedOn && completedOn < since;
}

export function isRecurring(raw: string): boolean {
  const s = raw
    .toLowerCase()
    .replace(/[''`‘’]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
  if (!s) return false;
  return !/^(no|none|never|off|one time|no repeat|dont repeat|doesnt repeat|does not repeat|do not repeat)$/.test(
    s,
  );
}

export function createdAtFrom(row: Record<string, string>, headers: string[]) {
  const created = parseDateOnly(cell(row, headers, "Created Date", "Created On", "Created"));
  return created
    ? Timestamp.fromDate(new Date(`${created}T00:00:00`))
    : FieldValue.serverTimestamp();
}

/** Human label for the preview's rock-type column. */
export function rockTypeLabel(t: string): string {
  if (t === "individual") return "Individual rock";
  if (t === "company") return "Company rock";
  return "Team rock";
}

/**
 * archived_at for a NEW imported row. Archived rows previously landed with
 * `archived_at: null` — i.e. "Include archived rows" resurrected finished work
 * as live work, the opposite of what the checkbox says. An
 * archived row now carries its Archived Date, falling back to import time when
 * the export has the flag but no parseable date.
 *
 * Only ever written on create. An existing doc keeps whatever archive state it
 * has, so a re-import can neither un-archive something filed in the app nor
 * archive something the team has revived.
 */
export function archivedAtFrom(row: Record<string, string>, headers: string[]) {
  if (!isArchived(row, headers)) return null;
  const on = parseDateOnly(
    cell(row, headers, "Archived Date", "Archived On", "Archived"),
  );
  return on
    ? Timestamp.fromDate(new Date(`${on}T00:00:00`))
    : FieldValue.serverTimestamp();
}

export function normalizeIssueType(raw: string, sheetName?: string): "short" | "long" {
  const s = (raw || sheetName || "").trim().toLowerCase();
  if (/^long/.test(s) || s.includes("long-term") || s.includes("long term")) {
    return "long";
  }
  return "short";
}

export function normalizeIssuePriority(
  raw: string,
): "urgent" | "high" | "medium" | "low" | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/urgent|critical|p0/.test(s)) return "urgent";
  if (/^high|p1/.test(s)) return "high";
  if (/^med|p2/.test(s)) return "medium";
  if (/^low|p3/.test(s)) return "low";
  return null;
}

export function normalizeIssueStatus(
  raw: string,
  completedOn: string | null,
): "open" | "solving" | "solved" | "dropped" {
  const s = (raw ?? "").trim().toLowerCase().replace(/[-_]/g, " ");
  if (/solv(ed|e)|done|complete|closed|resolved/.test(s) && !/solving|in progress/.test(s)) {
    return "solved";
  }
  if (/drop|archiv|cancel|abandon|deleted/.test(s)) return "dropped";
  if (/solving|in progress|ids|discuss/.test(s)) return "solving";
  if (completedOn) return "solved";
  return "open";
}

export function normalizeHeadlineKind(
  typeCell: string,
  sheetName?: string,
): "customer" | "employee" | "cascading" | "general" {
  const s = `${typeCell} ${sheetName ?? ""}`.toLowerCase();
  if (/cascad/.test(s)) return "cascading";
  if (/general|fyi/.test(s)) return "general";
  if (/customer|client|win/.test(s)) return "customer";
  if (/employee|people|hr|staff/.test(s)) return "employee";
  return "employee";
}

/** One field to length-check: [label shown to the operator, value, max chars]. */
export type LengthCheck = readonly [label: string, value: string | null | undefined, max: number];

/**
 * C-10 follow-up: the same caps the create/update server actions enforce
 * (lib/text-limits.ts) applied to an imported row. Returns the first
 * "<label> too long (max N chars)" message, or null when every field fits.
 * Nothing is truncated — an over-length row is rejected, not rewritten.
 */
export function overLengthReason(checks: readonly LengthCheck[]): string | null {
  for (const [label, value, max] of checks) {
    try {
      requireMaxLength(value, max, label);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  return null;
}

/**
 * Importers' shared over-length gate. When a row fails, records a skip in the
 * preview (the importer's existing per-row reporting) and returns true so the
 * caller counts it skipped and moves on. The echoed title is clipped: the
 * whole point is that the value may be megabytes, and the preview rides back
 * in the server-action response.
 */
export function rejectOverLength(
  preview: PreviewCollector,
  kind: ImportKind,
  title: string,
  checks: readonly LengthCheck[],
  detail: string[] = [],
): boolean {
  const reason = overLengthReason(checks);
  if (!reason) return false;
  preview.add({
    kind,
    action: "skip",
    title: title.length > 80 ? `${title.slice(0, 80)}…` : title,
    owner: "—",
    detail,
    note: `Not imported — ${reason}`,
  });
  return true;
}
