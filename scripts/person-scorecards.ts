// Read-only: one person's scorecard measurables, and every same-named
// measurable on other teams — who owns it, whether it is unassigned, and
// which weeks' numbers disagree with the person's. Touches nothing.
//
// Usage:
//   pnpm person:scorecards --target prod "Katy Bell"
//   pnpm person:scorecards --target prod katy.bell@highplainsbank.com
//   pnpm person:scorecards --target prod "Katy Bell" --csv /path/out.csv
//   pnpm person:scorecards --target prod "Katy Bell" --anon --key /path/key.csv
//
//   --anon        people and measurables print as "Person 01" / "Measurable 001"
//                 (numbers, weeks and teams unchanged) — safe to paste elsewhere
//   --key <path>  where --anon writes the alias → real name key (default: the
//                 OS temp dir). Keep it local.

import "./lib/load-target"; // first: sets up env before anything reads it
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Anonymizer } from "./lib/anon";
import { getAdminDb } from "../lib/firebase/admin";
import { normalizeKey, normalizePersonKey } from "../lib/csv-import";
import { importedOwnerOf } from "../lib/scorecard-share-repair";
import { explainDifferences, summarizeCauses, type DiffExplanation, type Point } from "../lib/scorecard-diff";

type Metric = {
  id: string;
  team_id: string;
  name: string;
  owner_id: string | null;
  description?: string | null;
  group?: string | null;
  is_public?: boolean | null;
  shared_team_ids?: string[] | null;
  archived_at?: unknown;
  import_source?: string | null;
};

function args() {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const valued = new Set(["--csv", "--target", "--key"]);
  const who = argv.find((a, j) => !a.startsWith("--") && !valued.has(argv[j - 1]));
  return { who, csv: value("--csv"), anon: argv.includes("--anon"), key: value("--key") };
}

function displayName(u: Record<string, unknown>): string {
  return (
    (u.display_name as string) ||
    [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
    (u.email as string) ||
    ""
  );
}

async function main() {
  const { who, csv, anon: anonOn, key: keyPath } = args();
  const anon = new Anonymizer(anonOn);
  if (!who) throw new Error('Pass a name or email, e.g. "Katy Bell".');
  const db = getAdminDb();

  const users = (await db.collection("users").get()).docs;
  const userName = new Map(users.map((d) => [d.id, displayName(d.data()) || d.id]));
  const nameOf = (uid: string | null) => (uid ? anon.person(userName.get(uid) ?? uid) : "No Owner");
  const key = who.includes("@") ? who.trim().toLowerCase() : normalizePersonKey(who);
  const people = users.filter((d) =>
    who.includes("@")
      ? String(d.data().email ?? "").toLowerCase() === key
      : normalizePersonKey(displayName(d.data())) === key,
  );
  if (people.length === 0) throw new Error(`No user named "${who}".`);
  const uids = new Set(people.map((d) => d.id));

  const teamName = new Map<string, string>();
  for (const t of (await db.collection("teams").get()).docs) teamName.set(t.id, (t.data().name as string) ?? t.id);
  const team = (id: string) => teamName.get(id) ?? id;

  const whoShown = anon.person(people.length ? displayName(people[0].data()) || who : who);
  console.log(`\n${whoShown}:`);
  for (const p of people) {
    const memberships = (await db.collection("team_members").where("user_id", "==", p.id).get()).docs;
    console.log(
      `  ${anonOn ? "(account)" : `${p.id}  ${String(p.data().email ?? "no email")}`}  — on ${
        memberships.map((m) => `${team(m.data().team_id as string)}${m.data().role === "leader" ? " (leader)" : ""}`).join(", ") || "no team"
      }`,
    );
  }
  if (people.length > 1) console.log("  ⚠ More than one user doc carries this name — measurables may be split between them.");

  const metrics: Metric[] = (await db.collection("scorecard_metrics").get()).docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Metric, "id">),
  }));
  const active = metrics.filter((m) => m.archived_at == null);
  const theirs = active.filter((m) => m.owner_id && uids.has(m.owner_id));
  const theirKeys = new Set(theirs.map((m) => normalizeKey(m.name)));
  // Unassigned copies whose kept owner note names this person, even under a
  // name of their own that matches none of theirs.
  const personKeys = new Set(people.map((p) => normalizePersonKey(displayName(p.data()))));
  const namedForThem = active.filter(
    (m) => !m.owner_id && personKeys.has(normalizePersonKey(importedOwnerOf(m.description) ?? "")),
  );
  for (const m of namedForThem) theirKeys.add(normalizeKey(m.name));

  const byName = new Map<string, Metric[]>();
  for (const m of active) {
    const k = normalizeKey(m.name);
    if (theirKeys.has(k)) byName.set(k, [...(byName.get(k) ?? []), m]);
  }

  const values = new Map<string, Map<string, Point>>();
  for (const m of [...byName.values()].flat()) {
    const snap = await db.collection("scorecard_entries").where("metric_id", "==", m.id).get();
    values.set(
      m.id,
      new Map(
        snap.docs.map((d) => {
          const x = d.data();
          const t = x.updated_at ?? x.created_at;
          return [
            x.week_start_date as string,
            { value: (x.value as number | null) ?? null, updatedAt: typeof t?.toMillis === "function" ? t.toMillis() : null },
          ];
        }),
      ),
    );
  }
  // How each period lines up, and — where they disagree — why (lib/scorecard-diff.ts).
  const compare = (original: string, copy: string): DiffExplanation => explainDifferences(values.get(original)!, values.get(copy)!);
  const VERDICT_TEXT: Record<DiffExplanation["verdict"], string> = {
    agree: "",
    "stale-copy": "LACK OF UPDATES on this copy",
    "stale-original": "LACK OF UPDATES on the original",
    shifted: "numbers entered a period early/late",
    mixed: "explained (missed updates and shifts)",
    conflict: "CONFLICT — numbers nothing explains",
  };

  type Row = { measurable: string; team: string; owner: string; kind: string; trackedBy: string; weeks: number; vsTheirs: string };
  const rows: Row[] = [];
  let differCount = 0;
  let unassignedCount = 0;
  // One verdict per measurable name, so a long list can be scanned instead
  // of read: DIFFERS first, then what can be unified, then what is clean.
  const verdicts: { verdict: string; measurable: string; detail: string }[] = [];

  console.log(`\n${theirs.length} measurable(s) owned by ${whoShown}${namedForThem.length ? `, ${namedForThem.length} unassigned naming them` : ""}:\n`);
  for (const [, group] of [...byName].sort((a, b) => a[0].localeCompare(b[0]))) {
    const own = group.filter((m) => m.owner_id && uids.has(m.owner_id));
    const others = group.filter((m) => !own.includes(m));
    let groupDiffers = 0;
    let groupConflicts = 0;
    let groupUnassigned = 0;
    console.log(`■ ${anon.measurable(group[0].name)}`);
    for (const m of own) {
      const tracked = (m.shared_team_ids ?? []).map(team);
      console.log(
        `    ${team(m.team_id)} — ${nameOf(m.owner_id)}${m.group && !anonOn ? `, section "${m.group}"` : ""}, ${m.is_public ? "public" : "private"}${tracked.length ? `, tracked by ${tracked.join(", ")}` : ""}  (${values.get(m.id)!.size} weeks)`,
      );
      rows.push({ measurable: anon.measurable(m.name), team: team(m.team_id), owner: nameOf(m.owner_id), kind: "theirs", trackedBy: tracked.join("; "), weeks: values.get(m.id)!.size, vsTheirs: "" });
    }
    for (const m of others) {
      const unassigned = !m.owner_id;
      if (unassigned) {
        unassignedCount++;
        groupUnassigned++;
      }
      const note = importedOwnerOf(m.description);
      const ref = own[0];
      const cmp = ref ? compare(ref.id, m.id) : null;
      if (cmp?.diffs.length) {
        differCount++;
        groupDiffers++;
        if (cmp.verdict === "conflict") groupConflicts++;
      }
      const vs = !cmp
        ? "no owned original to compare"
        : cmp.diffs.length === 0
          ? "numbers agree"
          : `${cmp.diffs.length} period(s) DIFFER — ${VERDICT_TEXT[cmp.verdict]}`;
      const label = unassigned ? `UNASSIGNED${note ? ` (imported owner: ${anon.person(note)})` : ""}` : `owned by ${nameOf(m.owner_id)}`;
      console.log(`    ${team(m.team_id)} — ${label}  (${values.get(m.id)!.size} weeks) — ${vs}`);
      if (cmp?.diffs.length) {
        console.log(
          `        last number: original ${cmp.lastOriginal ?? "—"}, copy ${cmp.lastCopy ?? "—"}${cmp.divergesFrom ? ` · agree until ${cmp.divergesFrom}` : ""}`,
        );
        console.log(`        ${summarizeCauses(cmp.diffs)}`);
        for (const d of cmp.diffs.slice(0, 8)) {
          console.log(`        ${d.week}: ${d.original ?? "—"} vs ${d.copy ?? "—"}  (${d.cause.replace(/-/g, " ")}${d.side ? `, ${d.side}` : ""})`);
        }
        if (cmp.diffs.length > 8) console.log(`        … ${cmp.diffs.length - 8} more`);
      }
      rows.push({
        measurable: anon.measurable(m.name),
        team: team(m.team_id),
        owner: unassigned ? "" : nameOf(m.owner_id),
        kind: unassigned ? "unassigned" : "other owner",
        trackedBy: "",
        weeks: values.get(m.id)!.size,
        vsTheirs: cmp?.diffs.length ? `${vs}: ${summarizeCauses(cmp.diffs)}` : vs,
      });
    }
    const verdict =
      own.length === 0
        ? "NO ORIGINAL"
        : own.length > 1
          ? "SEVERAL OWNED"
          : groupConflicts
            ? "CONFLICT"
            : groupDiffers
              ? "STALE"
              : groupUnassigned
              ? "UNIFY"
              : "OK";
    const detail = [
      own.length ? `${team(own[0].team_id)}` : "",
      groupUnassigned ? `${groupUnassigned} unassigned elsewhere` : "",
      others.length - groupUnassigned ? `${others.length - groupUnassigned} owned by others` : "",
      groupConflicts ? `${groupConflicts} with numbers nothing explains` : "",
      groupDiffers - groupConflicts ? `${groupDiffers - groupConflicts} differing from missed/late updates` : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`    → ${verdict}${detail ? ` (${detail})` : ""}`);
    verdicts.push({ verdict, measurable: anon.measurable(group[0].name), detail });
  }

  const ORDER = ["CONFLICT", "SEVERAL OWNED", "NO ORIGINAL", "STALE", "UNIFY", "OK"];
  verdicts.sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.measurable.localeCompare(b.measurable));
  console.log("\nSummary:");
  for (const v of ORDER) {
    const list = verdicts.filter((x) => x.verdict === v);
    if (list.length === 0) continue;
    console.log(`  ${v} — ${list.length}`);
    for (const x of list) console.log(`    ${x.measurable}${x.detail ? `  (${x.detail})` : ""}`);
  }

  console.log(
    `\nOwned: ${theirs.length} · Same name elsewhere unassigned: ${unassignedCount} · With differing numbers: ${differCount}`,
  );

  if (csv) {
    const cols: (keyof Row)[] = ["measurable", "team", "owner", "kind", "trackedBy", "weeks", "vsTheirs"];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    writeFileSync(csv, [cols.join(","), ...rows.map((r) => cols.map((c) => esc(String(r[c]))).join(","))].join("\n"));
    console.log(`CSV: ${csv}`);
  }
  if (anonOn) {
    const path = keyPath ?? join(tmpdir(), `scorecard-anon-key-${Date.now()}.csv`);
    anon.writeKey(path);
    console.log(`\nAnonymized. Key (alias → real name), keep it local: ${path}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
