// One record per shared measurable. ninety exports a shared measurable from
// every team that tracks it, so the import left a "No Owner" copy on each
// tracking team beside the owned original on the owner's team. For each
// name this keeps the original — the parent: its owner, its team, its group —
// and with --apply:
//   1. copies onto the parent any week only a copy has;
//   2. makes the parent public and has each copy's team track it, in the
//      section that team had the copy in;
//   3. deletes the copies and their values (now on the parent).
// Pairing rules: lib/scorecard-share-repair.ts.
//
// Dry-run by default: prints one line per measurable — parent, owner, the
// teams it will be shared to — and everything left for a person to decide.
//
// Usage:
//   pnpm scorecard:share-repair --target prod
//   pnpm scorecard:share-repair --target prod --team "Transformation"
//   pnpm scorecard:share-repair --target prod --csv /path/out.csv
//   pnpm scorecard:share-repair --target prod --apply --actor <your uid>
//
//   --team <name|id>  only copies on this team
//   --only <name>     only measurables with this name (repeatable)
//   --csv <path>      also write the report as CSV
//   --apply           write it — asks y/n/q before each measurable
//   --yes             don't ask (for a single --only run, or a reviewed list)
//   --keep-original-numbers
//                     also unify copies whose numbers differ; the original's
//                     numbers win and the copy's are deleted with it
//   --actor <uid>     stamped as updated_by / deleted_by (required with --apply)

import "./lib/load-target"; // first: sets up env before anything reads it
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase/admin";
import { stamp, stampBeforeDelete } from "../lib/audit-stamp";
import { recordAccessChange } from "../lib/access-audit";
import { normalizeKey } from "../lib/csv-import";
import {
  groupByParent,
  planShareRepairs,
  type EntriesByMetric,
  type RepairMetric,
  type RepairPlan,
} from "../lib/scorecard-share-repair";

function args() {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const only: string[] = [];
  argv.forEach((a, i) => a === "--only" && argv[i + 1] && only.push(argv[i + 1]));
  return {
    team: value("--team"),
    only,
    csv: value("--csv"),
    apply: argv.includes("--apply"),
    yes: argv.includes("--yes"),
    keepOriginal: argv.includes("--keep-original-numbers"),
    actor: value("--actor"),
  };
}

const CHECK: Partial<Record<RepairPlan["status"], string>> = {
  "values-differ": "CHECK — numbers differ from the original",
  ambiguous: "CHECK — several owned measurables by this name",
  "no-match": "NO MATCH — nothing owned elsewhere (owner queue)",
};

async function main() {
  const opts = args();
  if (opts.apply && !opts.actor) throw new Error("--apply needs --actor <your uid>.");
  if (opts.apply && !opts.yes && !process.stdin.isTTY) {
    throw new Error("--apply asks before each measurable and needs a terminal — or pass --yes.");
  }
  const db = getAdminDb();

  const teamName = new Map<string, string>();
  for (const t of (await db.collection("teams").get()).docs) {
    teamName.set(t.id, (t.data().name as string) ?? t.id);
  }
  const team = (id: string) => teamName.get(id) ?? id;
  let teamFilter: string | null = null;
  if (opts.team) {
    teamFilter =
      [...teamName].find(([id, name]) => id === opts.team || normalizeKey(name) === normalizeKey(opts.team!))?.[0] ?? null;
    if (!teamFilter) throw new Error(`No team "${opts.team}".`);
  }

  const metrics: RepairMetric[] = (await db.collection("scorecard_metrics").get()).docs.map(
    (d) => ({ id: d.id, ...(d.data() as Omit<RepairMetric, "id">) }),
  );

  const userName = new Map<string, string>();
  const ownerIds = [...new Set(metrics.map((m) => m.owner_id).filter((x): x is string => !!x))];
  for (let i = 0; i < ownerIds.length; i += 300) {
    const refs = ownerIds.slice(i, i + 300).map((id) => db.collection("users").doc(id));
    for (const d of await db.getAll(...refs)) {
      const u = d.data() ?? {};
      userName.set(
        d.id,
        (u.display_name as string) ||
          [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
          (u.email as string) ||
          d.id,
      );
    }
  }
  const nameOf = (uid: string) => userName.get(uid) ?? uid;

  // Values only for measurables that could be compared: unowned ones and
  // anything sharing a name with one.
  const onlyKeys = new Set(opts.only.map(normalizeKey));
  const inScope = (m: RepairMetric) =>
    (!teamFilter || m.team_id === teamFilter) && (onlyKeys.size === 0 || onlyKeys.has(normalizeKey(m.name)));
  const unownedKeys = new Set(
    metrics.filter((m) => !m.owner_id && m.archived_at == null && inScope(m)).map((m) => normalizeKey(m.name)),
  );
  const relevant = metrics.filter((m) => unownedKeys.has(normalizeKey(m.name)));
  const entries: EntriesByMetric = new Map();
  const entryRefs = new Map<string, DocumentReference[]>();
  for (const m of relevant) {
    const snap = await db.collection("scorecard_entries").where("metric_id", "==", m.id).get();
    entryRefs.set(m.id, snap.docs.map((d) => d.ref));
    entries.set(
      m.id,
      new Map(snap.docs.map((d) => [d.data().week_start_date as string, (d.data().value as number | null) ?? null])),
    );
  }

  const plans = planShareRepairs(relevant, entries, nameOf).filter((p) => inScope(p.unowned));
  const groups = groupByParent(plans, entries, opts.keepOriginal).sort((a, b) => a.parent.name.localeCompare(b.parent.name));
  const ready = groups.filter((g) => g.conflicts.length === 0);
  const blocked = groups.filter((g) => g.conflicts.length > 0);
  const unresolved = plans
    .filter((p) => CHECK[p.status] && !(opts.keepOriginal && p.status === "values-differ" && p.match))
    .sort((a, b) => a.status.localeCompare(b.status) || a.unowned.name.localeCompare(b.unowned.name));

  type Row = { action: string; measurable: string; parentTeam: string; owner: string; sharedTo: string; note: string };
  const rows: Row[] = [];

  console.log(`\n${ready.length} measurable(s) to unify:\n`);
  for (const g of ready) {
    const sharedTo = g.copies.map((c) => team(c.unowned.team_id));
    const note = [
      g.addWeeks.size ? `${g.addWeeks.size} week(s) copied onto the original` : "",
      g.parent.is_public ? "" : "made public",
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(`[UNIFY] ${g.parent.name} — ${team(g.parent.team_id)}, ${nameOf(g.parent.owner_id!)}`);
    console.log(`    shared to: ${sharedTo.join(", ")}  (their No Owner copies deleted)`);
    if (note) console.log(`    ${note}`);
    rows.push({ action: "UNIFY", measurable: g.parent.name, parentTeam: team(g.parent.team_id), owner: nameOf(g.parent.owner_id!), sharedTo: sharedTo.join("; "), note });
  }

  if (blocked.length || unresolved.length) console.log(`\nLeft for you (${blocked.length + unresolved.length}):\n`);
  for (const g of blocked) {
    const note = `copies disagree on ${g.conflicts.join(", ")}`;
    console.log(`[CHECK — copies disagree] ${g.parent.name} — ${team(g.parent.team_id)}, ${nameOf(g.parent.owner_id!)}`);
    console.log(`    ${note}`);
    rows.push({ action: "CHECK", measurable: g.parent.name, parentTeam: team(g.parent.team_id), owner: nameOf(g.parent.owner_id!), sharedTo: g.copies.map((c) => team(c.unowned.team_id)).join("; "), note });
  }
  for (const p of unresolved) {
    const note = [
      p.importedOwner ? `imported owner: ${p.importedOwner}` : "",
      p.status === "ambiguous"
        ? `candidates: ${p.candidates.map((c) => `${team(c.team_id)} (${nameOf(c.owner_id!)})`).join("; ")}`
        : "",
      p.weeksDiffering.length
        ? `differ: ${p.weeksDiffering.slice(0, 6).join(", ")}${p.weeksDiffering.length > 6 ? "…" : ""}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(`[${CHECK[p.status]}] ${team(p.unowned.team_id)} › ${p.unowned.name}`);
    if (p.match) console.log(`    original: ${team(p.match.team_id)}, ${nameOf(p.match.owner_id!)}`);
    if (note) console.log(`    ${note}`);
    rows.push({
      action: CHECK[p.status]!,
      measurable: p.unowned.name,
      parentTeam: p.match ? team(p.match.team_id) : "",
      owner: p.match ? nameOf(p.match.owner_id!) : "",
      sharedTo: team(p.unowned.team_id),
      note,
    });
  }

  console.log(
    `\nUnify: ${ready.length} (deleting ${ready.reduce((n, g) => n + g.copies.length, 0)} copies) · Left for you: ${blocked.length + unresolved.length}`,
  );

  if (opts.csv) {
    const cols: (keyof Row)[] = ["action", "measurable", "parentTeam", "owner", "sharedTo", "note"];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    writeFileSync(opts.csv, [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n"));
    console.log(`CSV: ${opts.csv}`);
  }

  if (!opts.apply) {
    console.log("\nDry run — nothing written. Re-run with --apply --actor <uid> to unify the UNIFY rows.");
    return;
  }

  const actor = opts.actor!;
  const rl = opts.yes ? null : createInterface({ input: process.stdin, output: process.stdout });
  let done = 0;
  for (const [i, g] of ready.entries()) {
    if (rl) {
      const answer = (
        await rl.question(
          `\n(${i + 1}/${ready.length}) ${g.parent.name} — keep ${team(g.parent.team_id)} / ${nameOf(g.parent.owner_id!)}, share to ${g.copies.map((c) => team(c.unowned.team_id)).join(", ")}, delete ${g.copies.length} cop${g.copies.length === 1 ? "y" : "ies"}? [y/n/q] `,
        )
      ).trim().toLowerCase();
      if (answer === "q") break;
      if (answer !== "y") {
        console.log("  skipped");
        continue;
      }
    }
    const parentRef = db.collection("scorecard_metrics").doc(g.parent.id);
    const before = [...(g.parent.shared_team_ids ?? [])];
    const copyTeams = g.copies.map((c) => c.unowned.team_id);

    // 1–2: weeks first, then the share — the copies are only deleted once
    // the parent carries everything they held.
    const batch = db.batch();
    for (const [week, value] of g.addWeeks) {
      batch.set(db.collection("scorecard_entries").doc(`${g.parent.id}__${week}`), {
        metric_id: g.parent.id,
        week_start_date: week,
        value,
        note: null,
        import_source: "csv",
        created_at: FieldValue.serverTimestamp(),
        ...stamp(actor),
      });
    }
    batch.update(parentRef, {
      is_public: true,
      shared_team_ids: FieldValue.arrayUnion(...copyTeams),
      ...Object.fromEntries(g.copies.map((c) => [`shared_groups.${c.unowned.team_id}`, c.unowned.group ?? null])),
      ...stamp(actor),
    });
    await batch.commit();

    if (!g.parent.is_public) {
      await recordAccessChange(db, {
        kind: "metric_public",
        actorUid: actor,
        entityId: g.parent.id,
        teamId: g.parent.team_id,
        before: { is_public: false },
        after: { is_public: true },
      });
    }
    const after = [...new Set([...before, ...copyTeams])];
    for (const tid of copyTeams.filter((t) => !before.includes(t))) {
      await recordAccessChange(db, {
        kind: "track",
        actorUid: actor,
        entityId: g.parent.id,
        teamId: tid,
        before: { shared_team_ids: before },
        after: { shared_team_ids: after, tracked_by_team_id: tid },
      });
    }

    // 3: the copies and their values. Stamped first so audit_log names who.
    for (const c of g.copies) {
      const refs = [...(entryRefs.get(c.unowned.id) ?? []), db.collection("scorecard_metrics").doc(c.unowned.id)];
      await stampBeforeDelete(refs, actor);
      for (let i = 0; i < refs.length; i += 400) {
        const del = db.batch();
        refs.slice(i, i + 400).forEach((r) => del.delete(r));
        await del.commit();
      }
    }
    console.log(`  ✓ ${g.parent.name}`);
    done++;
  }
  rl?.close();
  console.log(`\nUnified ${done} measurable(s).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
