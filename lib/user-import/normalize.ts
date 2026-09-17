// Seed-file → SeedPersonRow reading. IO-free so every column-spelling and
// name-splitting rule is unit testable without Firestore.

import { cell, normalizeKey, type CsvTable } from "../csv-import";
import type { SeedIssue, SeedPersonRow } from "../user-import-types";

// Accepted spellings per column. `cell()` matches case- and
// whitespace-insensitively, so these only need to cover real alternatives.
const FIRST = ["First", "First Name", "Firstname", "Given Name", "Given"];
const LAST = ["Last", "Last Name", "Lastname", "Surname", "Family Name"];
const FULL = ["Name", "Full Name", "Member", "Person", "Employee"];
const EMAIL = ["Email", "Email Address", "E-mail", "E-mail Address", "Work Email"];
const TEAM = ["Team", "Teams", "Department", "Dept", "Group"];
// **Access, not a job title.** `Role access` is the client's column name and
// the one that decides permissions: "admin" grants the org-admin claim,
// anything else is a plain member. Ordered so the explicit spelling wins when
// a file somehow carries both.
const ACCESS = ["Role access", "Access", "Access level", "Permission", "Role"];
// A genuine job title, if the file happens to carry one. Display only — it has
// never granted anything and still doesn't.
const TITLE = ["Job Title", "Position", "Title"];

/**
 * A Team cell may name several teams. Split on semicolon, pipe and newline —
 * **not** comma: a comma inside a quoted cell is as likely to be part of one
 * team's name ("Lending, Retail & Ops") as a separator, and guessing wrong
 * silently invents teams. Operators who need multiple teams use `;`.
 */
const TEAM_SPLIT = /[;|\n]+/;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Read the Role access cell.
 *
 * Only "admin" grants anything — everything else, blank included, is a plain
 * member. Values that are neither are reported rather than silently treated as
 * member, because a file saying "Owner" or "Leader" is one somebody expected
 * to mean something, and quietly flattening it is how a roster ends up wrong
 * in a way nobody notices.
 */
export function readAccess(raw: string): {
  orgAdmin: boolean;
  recognized: boolean;
} {
  const key = normalizeKey(raw);
  if (!key) return { orgAdmin: false, recognized: true };
  // "admin", "Admin", "Org Admin", "administrator", "admin access".
  if (/\badmin(istrator)?\b/.test(key)) return { orgAdmin: true, recognized: true };
  if (/\b(member|user|standard|normal|none|staff)\b/.test(key)) {
    return { orgAdmin: false, recognized: true };
  }
  return { orgAdmin: false, recognized: false };
}

/**
 * Split a single Name cell into first/last. Handles "Doe, Jane" (last-first,
 * how directory exports usually write it) and "Jane van Doe" (everything
 * after the first token is the surname, so particles survive).
 */
export function splitFullName(raw: string): { first: string; last: string } {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { first: "", last: "" };

  const comma = s.indexOf(",");
  if (comma > 0) {
    const last = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    if (first) return { first, last };
    return { first: last, last: "" };
  }

  const parts = s.split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * Last-resort name from the address: "jane.doe@bank.com" → Jane Doe. Only
 * used when the file gives no name at all — a row with a real address and no
 * name is still worth importing, and the person can fix their display name
 * later. Mirrors the email-local-part trick OwnerResolver already uses to
 * match owners.
 */
export function nameFromEmail(email: string): { first: string; last: string } {
  const local = (email.split("@")[0] ?? "").replace(/[._-]+/g, " ").trim();
  if (!local) return { first: "", last: "" };
  const titled = local
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return splitFullName(titled);
}

/**
 * Read a parsed seed table into person rows, collecting per-row problems
 * rather than throwing: one malformed line must not cost the operator the
 * other two hundred.
 */
export function readSeedRows(table: CsvTable): {
  rows: SeedPersonRow[];
  issues: SeedIssue[];
} {
  const rows: SeedPersonRow[] = [];
  const issues: SeedIssue[] = [];
  const { headers } = table;

  table.rows.forEach((row, i) => {
    const line = i + 1;
    const email = cell(row, headers, ...EMAIL).toLowerCase().replace(/\s+/g, "");

    let first = cell(row, headers, ...FIRST);
    let last = cell(row, headers, ...LAST);
    if (!first && !last) {
      const split = splitFullName(cell(row, headers, ...FULL));
      first = split.first;
      last = split.last;
    }

    const label = [`${first} ${last}`.trim(), email].filter(Boolean).join(" ");

    if (!email) {
      issues.push({
        line,
        label: label || "(blank row)",
        reason: "No email address — an account cannot be created without one.",
      });
      return;
    }
    if (!isValidEmail(email)) {
      issues.push({ line, label, reason: `"${email}" is not a valid email address.` });
      return;
    }

    if (!first && !last) {
      const derived = nameFromEmail(email);
      first = derived.first;
      last = derived.last;
    }

    const teams = cell(row, headers, ...TEAM)
      .split(TEAM_SPLIT)
      .map((t) => t.trim())
      .filter(Boolean);

    const accessRaw = cell(row, headers, ...ACCESS);
    const access = readAccess(accessRaw);

    rows.push({
      line,
      firstName: first,
      lastName: last,
      email,
      teams: dedupeByKey(teams),
      orgAdmin: access.orgAdmin,
      accessRaw: accessRaw || null,
      unrecognizedAccess: access.recognized ? null : accessRaw,
      title: cell(row, headers, ...TITLE) || null,
    });
  });

  return { rows, issues };
}

/** First spelling wins; "Ops" and "ops " collapse to one entry. */
export function dedupeByKey(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = normalizeKey(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

/**
 * Does this table look like a people seed at all? Checked before any write so
 * a rocks export dropped on the wrong page fails with a useful message
 * instead of creating two hundred empty teams.
 */
export function hasSeedColumns(table: CsvTable): boolean {
  const keys = table.headers.map((h) => normalizeKey(h));
  const has = (names: string[]) => names.some((n) => keys.includes(normalizeKey(n)));
  return has(EMAIL) && (has(FIRST) || has(LAST) || has(FULL));
}

export const SEED_COLUMNS = { FIRST, LAST, FULL, EMAIL, TEAM, ACCESS, TITLE };
