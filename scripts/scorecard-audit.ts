// Read-only org-wide scorecard audit (lib/scorecard-audit.ts): every active
// measurable categorized and every should-match pair diffed, then a per-person
// roll-up. Writes one .xlsx — it carries real names and emails, so it stays
// with whoever ran it — and prints a short summary. Touches nothing.
//
// Usage:
//   pnpm scorecard:audit --target prod
//   pnpm scorecard:audit --target prod --out ~/Desktop/audit.xlsx
//
//   --out <file>  where the workbook goes (default ~/Desktop/scorecard-audit-<date>.xlsx)
//
// Where an owner has a measurable made in the app, that is the original and
// imported copies are checked against it (lib/scorecard-audit.ts).
//
// Tabs:
//   Summary             — counts per gap, category, sync verdict and flag
//   Gaps                — every measurable needing a decision, with the gap named
//   App vs import       — imported copies of a measurable made in the app
//   Leftover duplicates — imported same-owner copies the merge held back
//   No Owner            — every measurable without an owner
//   Truly unassigned    — no owner and the name exists nowhere else
//   Conflicts           — copies whose numbers differ in ways nothing explains
//   Out of sync         — copies whose numbers differ from their original
//   People              — one row per person who owns a measurable or an original
//   Measurables         — every active measurable

import "./lib/load-target"; // first: sets up env before anything reads it
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeXlsx, type Cell } from "./lib/xlsx-writer";
import { getAdminDb } from "../lib/firebase/admin";
import { auditScorecards, isImported, originalGuess, type Category } from "../lib/scorecard-audit";
import { summarizeCauses, type Point } from "../lib/scorecard-diff";
import { normalizePersonKey } from "../lib/csv-import";
import { importedOwnerOf, type RepairMetric } from "../lib/scorecard-share-repair";

const CATEGORY_TEXT: Record<Category, string> = {
  original: "Original",
  "owned-duplicate": "Duplicate of own original on another team",
  "copy-of-original": "No Owner copy of an original",
  "copy-ambiguous": "No Owner — several possible originals",
  "unassigned-duplicated": "No Owner — name only on other No Owner copies",
  "unassigned-other-owner-has-name": "No Owner — name owned by someone the note doesn't name",
  "truly-unassigned": "TRULY UNASSIGNED",
};

const VERDICT_TEXT: Record<string, string> = {
  agree: "In sync",
  "stale-copy": "Lack of updates on this copy",
  "stale-original": "Lack of updates on the original",
  shifted: "Entered a period early/late",
  mixed: "Explained (missed + late updates)",
  conflict: "CONFLICT — nothing explains it",
};

/** Header row from the first object's keys ("owner_email" → "Owner email"), then values. */
function table(rows: Record<string, Cell>[], empty: string): Cell[][] {
  if (rows.length === 0) return [[empty]];
  const cols = Object.keys(rows[0]);
  const label = (c: string) => c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, " ");
  return [cols.map(label), ...rows.map((r) => cols.map((c) => r[c]))];
}

async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const out =
    outIdx >= 0
      ? argv[outIdx + 1].replace(/^~/, homedir())
      : join(homedir(), "Desktop", `scorecard-audit-${new Date().toISOString().slice(0, 10)}.xlsx`);
  const db = getAdminDb();

  const users = new Map<string, { name: string; email: string }>();
  for (const d of (await db.collection("users").get()).docs) {
    const u = d.data();
    users.set(d.id, {
      name:
        (u.display_name as string) ||
        [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
        (u.email as string) ||
        d.id,
      email: (u.email as string) ?? "",
    });
  }
  const nameOf = (uid: string) => users.get(uid)?.name ?? uid;
  const emailOf = (uid: string) => users.get(uid)?.email ?? "";

  const teamName = new Map<string, string>();
  for (const t of (await db.collection("teams").get()).docs) teamName.set(t.id, (t.data().name as string) ?? t.id);
  const team = (id: string) => teamName.get(id) ?? id;

  const memberships = new Map<string, Set<string>>();
  for (const d of (await db.collection("team_members").get()).docs) {
    const uid = d.data().user_id as string;
    memberships.set(uid, (memberships.get(uid) ?? new Set()).add(d.data().team_id as string));
  }

  const metrics: RepairMetric[] = (await db.collection("scorecard_metrics").get()).docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<RepairMetric, "id">),
  }));
  const activeIds = new Set(metrics.filter((m) => m.archived_at == null).map((m) => m.id));

  // One pass over every value, kept only for active measurables.
  const entries = new Map<string, Map<string, Point>>();
  for (const d of (await db.collection("scorecard_entries").get()).docs) {
    const x = d.data();
    const id = x.metric_id as string;
    if (!activeIds.has(id)) continue;
    const t = x.updated_at ?? x.created_at;
    const m = entries.get(id) ?? new Map<string, Point>();
    m.set(x.week_start_date as string, {
      value: (x.value as number | null) ?? null,
      updatedAt: typeof t?.toMillis === "function" ? t.toMillis() : null,
    });
    entries.set(id, m);
  }

  const { rows, people } = auditScorecards({ metrics, entries, memberships, nameOf });

  const lastOf = (id: string) => {
    let last = "";
    for (const [w, p] of entries.get(id) ?? []) if (p.value != null && w > last) last = w;
    return last;
  };
  const ORDER: Category[] = [
    "truly-unassigned",
    "unassigned-duplicated",
    "unassigned-other-owner-has-name",
    "copy-ambiguous",
    "copy-of-original",
    "owned-duplicate",
    "original",
  ];
  rows.sort(
    (a, b) =>
      ORDER.indexOf(a.category) - ORDER.indexOf(b.category) ||
      a.metric.name.localeCompare(b.metric.name) ||
      team(a.metric.team_id).localeCompare(team(b.metric.team_id)),
  );

  // The gap a row represents, if any — one label, most pressing first.
  type Row = (typeof rows)[number];
  const gapOf = (r: Row): string => {
    const m = r.metric;
    if (r.category === "truly-unassigned") return "Truly unassigned";
    if (!m.owner_id) return r.category === "copy-of-original" ? "No Owner copy of an owned measurable" : "No Owner";
    if (r.diff?.verdict === "conflict") return "Conflicting numbers";
    if (r.original && !isImported(r.original) && isImported(m)) return "Imported copy of an app measurable";
    if (r.category === "owned-duplicate") return "Leftover duplicate";
    if (!memberships.get(m.owner_id)?.has(m.team_id)) return "Owner not on team";
    return "";
  };
  const GAPS = [
    "Truly unassigned",
    "No Owner",
    "No Owner copy of an owned measurable",
    "Conflicting numbers",
    "Imported copy of an app measurable",
    "Leftover duplicate",
    "Owner not on team",
  ];

  // Plain-language reason and next step for a flagged row.
  const uidByName = new Map<string, string>();
  for (const [uid, u] of users) uidByName.set(normalizePersonKey(u.name), uid);
  const weeksText = (r: Row) => {
    const d = (r.diff?.diffs ?? []).filter((x) => x.original != null && x.copy != null);
    if (d.length === 0) return "";
    const shown = d.slice(0, 4).map((x) => `${x.week}: ${x.original} on the original vs ${x.copy} here`).join("; ");
    return ` Numbers differ in ${d.length} week(s) — ${shown}${d.length > 4 ? "; …" : ""}.`;
  };
  const explain = (r: Row, gap: string): { why: string; next: string } => {
    const m = r.metric;
    const where = team(m.team_id);
    const o = r.original;
    const fromNinety = importedOwnerOf(m.description);
    switch (gap) {
      case "Truly unassigned": {
        let who = "ninety had no owner for it.";
        let next = `Assign an owner on ${where}'s scorecard — or delete it if ${where} no longer tracks it.`;
        if (fromNinety) {
          const uid = uidByName.get(normalizePersonKey(fromNinety));
          if (!uid) {
            who = `ninety's owner was ${fromNinety}, who has no Pulse account.`;
            next = `Add ${fromNinety} to Pulse and to ${where}, then assign them — or assign someone else.`;
          } else if (!memberships.get(uid)?.has(m.team_id)) {
            who = `ninety's owner was ${fromNinety}, who is in Pulse but not on ${where}.`;
            next = `Add ${fromNinety} to ${where} and assign them — or assign someone already on ${where}.`;
          } else {
            who = `ninety's owner was ${fromNinety}, who is on ${where} — the import didn't match the name.`;
            next = `Assign ${fromNinety} on ${where}'s scorecard.`;
          }
        }
        return { why: `No owner, and no other measurable in Pulse has this name. ${who}`, next };
      }
      case "No Owner copy of an owned measurable":
        return {
          why: `No owner on ${where}; the original is ${nameOf(o!.owner_id!)}'s on ${team(o!.team_id)}.${weeksText(r) || " " + (r.diff ? VERDICT_TEXT[r.diff.verdict] : "") + "."}`,
          next: r.diff?.verdict === "conflict"
            ? `Check which numbers are right. If the original's: pnpm scorecard:share-repair --target prod --only "${m.name}" --keep-original-numbers --apply --yes --actor <uid>. If this copy's: fix the original's weeks first, then run it without --keep-original-numbers.`
            : `pnpm scorecard:share-repair --target prod --only "${m.name}" --apply --yes --actor <uid>`,
        };
      case "Conflicting numbers":
        return {
          why: `${m.owner_id ? `${nameOf(m.owner_id)} owns this on ${where}` : `No owner on ${where}`}; the original is on ${team(o!.team_id)}.${weeksText(r)}`,
          next: r.category === "owned-duplicate"
            ? `Check which numbers are right. If the original's: pnpm scorecard:merge-duplicates --target prod --only "${m.name}" --keep-original-numbers --apply --yes --actor <uid>.`
            : `Check which numbers are right, then repair or merge it.`,
        };
      case "Imported copy of an app measurable":
        return {
          why: `Imported copy of ${nameOf(o!.owner_id!)}'s measurable made in the app on ${team(o!.team_id)}. ${r.diff ? VERDICT_TEXT[r.diff.verdict] : ""}.${weeksText(r)}`,
          next: `Left for cutover: the owner keeps the app version; delete this imported copy, or have ${team(m.team_id)} track the app one.`,
        };
      case "Leftover duplicate":
        return {
          why: `${nameOf(m.owner_id!)} owns this on ${where} and on ${team(o!.team_id)}; the merge held it back.${weeksText(r)}`,
          next: `pnpm scorecard:merge-duplicates --target prod --only "${m.name}" (the dry run says why it's held).`,
        };
      case "Owner not on team":
        return {
          why: `${nameOf(m.owner_id!)} owns it but isn't on ${where}'s roster.`,
          next: `Add ${nameOf(m.owner_id!)} to ${where}, or move ownership to someone on ${where}.`,
        };
      case "No Owner":
        return { why: `No owner on ${where}. ${CATEGORY_TEXT[r.category]}.`, next: `Assign an owner on ${where}'s scorecard.` };
      default:
        return { why: "", next: "" };
    }
  };

  const guess = originalGuess(rows, entries);
  const measurableRows = rows.map((r) => {
    const m = r.metric;
    const owner = m.owner_id;
    return {
      gap: gapOf(r),
      why_flagged: explain(r, gapOf(r)).why,
      next_step: explain(r, gapOf(r)).next,
      category: CATEGORY_TEXT[r.category],
      source: isImported(m) ? "Imported" : "Created in app",
      measurable: m.name,
      team: team(m.team_id),
      owner: owner ? nameOf(owner) : "No Owner",
      owner_email: owner ? emailOf(owner) : "",
      owner_on_team: owner ? (memberships.get(owner)?.has(m.team_id) ? "yes" : "NO") : "",
      imported_owner: importedOwnerOf(m.description) ?? "",
      public: m.is_public ? "yes" : "no",
      tracked_by: (m.shared_team_ids ?? []).map(team).join("; "),
      periods_with_values: [...(entries.get(m.id)?.values() ?? [])].filter((p) => p.value != null).length,
      last_value_period: lastOf(m.id),
      original_team: r.original ? team(r.original.team_id) : "",
      original_guess: (() => {
        const g = guess.get(m.id);
        return g ? team(g.team_id) : "";
      })(),
      original_owner: r.original ? nameOf(r.original.owner_id!) : "",
      original_source: r.original ? (isImported(r.original) ? "Imported" : "Created in app") : "",
      original_last_value_period: r.original ? lastOf(r.original.id) : "",
      sync: r.diff ? VERDICT_TEXT[r.diff.verdict] : "",
      periods_differing: r.diff?.diffs.length ?? "",
      agree_until: r.diff?.divergesFrom ?? "",
      causes: r.diff ? summarizeCauses(r.diff.diffs) : "",
      differing_periods: r.diff?.diffs.map((d) => `${d.week}: ${d.original ?? "—"} vs ${d.copy ?? "—"} (${d.cause})`).join(" | ") ?? "",
      metric_id: m.id,
      original_id: r.original?.id ?? "",
    };
  });

  const peopleRows = people.map((p) => ({
    flags: p.flags.join(" "),
    name: p.name,
    email: emailOf(p.uid),
    member_of: [...(memberships.get(p.uid) ?? [])].map(team).join("; "),
    measurables_owned: p.owned,
    measurables_on_teams: p.teams.map(team).join("; "),
    team_count: p.teams.length,
    off_roster: p.offRoster.map((m) => `${m.name} (${team(m.team_id)})`).join("; "),
    duplicated: p.duplicatedNames,
    no_owner_copies_to_unify: p.copiesToUnify,
    out_of_sync: p.outOfSync,
    conflicts: p.conflicts,
    uid: p.uid,
  }));

  const count = (c: Category) => rows.filter((r) => r.category === c).length;
  const diffed = rows.filter((r) => r.diff);
  const FLAGS = ["SCATTERED", "OFF ROSTER", "DUPLICATES", "OUT OF SYNC", "CONFLICT"] as const;
  const summary: Cell[][] = [
    ["Scorecard audit", new Date().toISOString().slice(0, 16).replace("T", " ")],
    [],
    ["Active measurables", rows.length],
    ["Made in the app", rows.filter((r) => !isImported(r.metric)).length],
    ["Imported", rows.filter((r) => isImported(r.metric)).length],
    ["People", people.length],
    [],
    ["Gap", "Measurables"],
    ...GAPS.map((g): Cell[] => [g, measurableRows.filter((x) => x.gap === g).length]),
    ["No gap", measurableRows.filter((x) => !x.gap).length],
    [],
    ["Category", "Measurables"],
    ...ORDER.map((c): Cell[] => [CATEGORY_TEXT[c], count(c)]),
    [],
    ["Should-match pairs", diffed.length],
    ...Object.entries(VERDICT_TEXT).map(([v, text]): Cell[] => [text, diffed.filter((r) => r.diff!.verdict === v).length]),
    [],
    ["People flagged", people.filter((p) => p.flags.length).length],
    ...FLAGS.map((f): Cell[] => [f, people.filter((p) => p.flags.includes(f)).length]),
  ];

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    writeXlsx([
      { name: "Summary", rows: summary, widths: [52, 18] },
      {
        name: "Gaps",
        rows: table(
          measurableRows
            .filter((x) => x.gap)
            .sort((a, b) => GAPS.indexOf(a.gap) - GAPS.indexOf(b.gap) || String(a.measurable).localeCompare(String(b.measurable))),
          "No gaps.",
        ),
      },
      {
        name: "App vs import",
        rows: table(
          measurableRows.filter((_, i) => rows[i].original && !isImported(rows[i].original!) && isImported(rows[i].metric)),
          "None.",
        ),
      },
      {
        name: "Leftover duplicates",
        rows: table(
          measurableRows.filter(
            (_, i) => rows[i].category === "owned-duplicate" && isImported(rows[i].metric) && isImported(rows[i].original!),
          ),
          "None.",
        ),
      },
      { name: "No Owner", rows: table(measurableRows.filter((_, i) => !rows[i].metric.owner_id), "None.") },
      {
        name: "Truly unassigned",
        rows: table(measurableRows.filter((_, i) => rows[i].category === "truly-unassigned"), "None."),
      },
      {
        name: "Conflicts",
        rows: table(measurableRows.filter((_, i) => rows[i].diff?.verdict === "conflict"), "None."),
      },
      {
        name: "Out of sync",
        rows: table(measurableRows.filter((_, i) => (rows[i].diff?.diffs.length ?? 0) > 0), "None."),
      },
      { name: "People", rows: table(peopleRows, "No one owns a measurable.") },
      { name: "Measurables", rows: table(measurableRows, "No active measurables.") },
    ]),
  );
  console.log(`\n${rows.length} active measurables, ${people.length} people\n`);
  console.log("  Gaps:");
  for (const g of GAPS) console.log(`    ${g}: ${measurableRows.filter((x) => x.gap === g).length}`);
  console.log("");
  // The unified list: every flagged measurable, why, and what to do.
  const flaggedRows = measurableRows
    .filter((x) => x.gap)
    .sort((a, b) => GAPS.indexOf(a.gap) - GAPS.indexOf(b.gap) || String(a.measurable).localeCompare(String(b.measurable)));
  if (flaggedRows.length) {
    console.log(`  Flagged measurables (${flaggedRows.length}):\n`);
    for (const x of flaggedRows) {
      console.log(`  [${x.gap}] ${x.measurable} — ${x.team}${x.owner !== "No Owner" ? ` (${x.owner})` : ""}`);
      console.log(`      Why:  ${x.why_flagged}`);
      console.log(`      Next: ${x.next_step}\n`);
    }
  }
  for (const c of ORDER) console.log(`  ${CATEGORY_TEXT[c]}: ${count(c)}`);
  console.log(
    `\n  Should-match pairs: ${diffed.length} — in sync ${diffed.filter((r) => r.diff!.verdict === "agree").length}, lack of updates ${
      diffed.filter((r) => r.diff!.verdict.startsWith("stale")).length
    }, early/late ${diffed.filter((r) => r.diff!.verdict === "shifted" || r.diff!.verdict === "mixed").length}, CONFLICT ${
      diffed.filter((r) => r.diff!.verdict === "conflict").length
    }`,
  );
  const flagged = people.filter((p) => p.flags.length);
  console.log(`\n  People flagged: ${flagged.length}`);
  for (const f of FLAGS) {
    console.log(`    ${f}: ${people.filter((p) => p.flags.includes(f)).length}`);
  }
  console.log(`\nWrote ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
