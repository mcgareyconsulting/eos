// Compress same-owner duplicates: the scorecard audit's "Duplicate of own
// original on another team" rows. Each duplicate's team ends up tracking the
// original (shared, one owner, one set of numbers) and the duplicate is
// deleted. Rules: lib/scorecard-duplicate-merge.ts; which copy is the
// original: lib/scorecard-audit.ts (the one on a team the owner is on, then
// the one with the most recent number).
//
// Dry run by default — prints every original, the teams it will be shared
// to, the weeks it gains, and anything held back.
//
// Run it after the last ninety import: re-importing a team's file recreates
// a deleted duplicate (import ids are fixed by team and name).
//
// Usage:
//   pnpm scorecard:merge-duplicates --target prod
//   pnpm scorecard:merge-duplicates --target prod --owner "Katy Bell"
//   pnpm scorecard:merge-duplicates --target prod --apply --actor <your uid>
//
//   --owner <name|email>   only this owner's measurables
//   --team <name|id>       only originals or duplicates on this team
//   --only <name>          only measurables with this name (repeatable)
//   --keep-original-numbers
//                          also merge where a duplicate's numbers differ; the
//                          original's numbers win
//   --include-app-created  also delete duplicates made in the app (default:
//                          imported ones only)
//   --apply                write — asks y/n/q before each measurable
//   --yes                  don't ask
//   --actor <uid>          stamped as updated_by / deleted_by (required with --apply)

import "./lib/load-target"; // first: sets up env before anything reads it
import { createInterface } from "node:readline/promises";
import { getAdminDb } from "../lib/firebase/admin";
import { normalizeKey, normalizePersonKey } from "../lib/csv-import";
import { auditScorecards } from "../lib/scorecard-audit";
import type { Point } from "../lib/scorecard-diff";
import { applyDuplicateMerge, planDuplicateMerges, type MergePlan } from "../lib/scorecard-duplicate-merge";
import type { RepairMetric } from "../lib/scorecard-share-repair";

function args() {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const only: string[] = [];
  argv.forEach((a, i) => a === "--only" && argv[i + 1] && only.push(argv[i + 1]));
  return {
    owner: value("--owner"),
    team: value("--team"),
    only,
    keepOriginal: argv.includes("--keep-original-numbers"),
    includeAppCreated: argv.includes("--include-app-created"),
    apply: argv.includes("--apply"),
    yes: argv.includes("--yes"),
    actor: value("--actor"),
  };
}

async function main() {
  const opts = args();
  if (opts.apply && !opts.actor) throw new Error("--apply needs --actor <your uid>.");
  if (opts.apply && !opts.yes && !process.stdin.isTTY) {
    throw new Error("--apply asks before each measurable and needs a terminal — or pass --yes.");
  }
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
      email: ((u.email as string) ?? "").toLowerCase(),
    });
  }
  const nameOf = (uid: string) => users.get(uid)?.name ?? uid;

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
  const entries = new Map<string, Map<string, Point>>();
  for (const d of (await db.collection("scorecard_entries").get()).docs) {
    const x = d.data();
    if (!activeIds.has(x.metric_id as string)) continue;
    const m = entries.get(x.metric_id as string) ?? new Map<string, Point>();
    m.set(x.week_start_date as string, { value: (x.value as number | null) ?? null });
    entries.set(x.metric_id as string, m);
  }

  const { rows } = auditScorecards({ metrics, entries, memberships, nameOf });
  let plans = planDuplicateMerges(rows, entries, {
    keepOriginalNumbers: opts.keepOriginal,
    includeAppCreated: opts.includeAppCreated,
  });

  if (opts.owner) {
    const key = opts.owner.includes("@") ? opts.owner.toLowerCase() : normalizePersonKey(opts.owner);
    const uids = new Set(
      [...users].filter(([, u]) => (opts.owner!.includes("@") ? u.email === key : normalizePersonKey(u.name) === key)).map(([id]) => id),
    );
    if (uids.size === 0) throw new Error(`No user "${opts.owner}".`);
    plans = plans.filter((p) => uids.has(p.original.owner_id!));
  }
  if (opts.team) {
    const id = [...teamName].find(([tid, n]) => tid === opts.team || normalizeKey(n) === normalizeKey(opts.team!))?.[0];
    if (!id) throw new Error(`No team "${opts.team}".`);
    plans = plans.filter((p) => p.original.team_id === id || p.duplicates.some((d) => d.team_id === id));
  }
  if (opts.only.length) {
    const keys = new Set(opts.only.map(normalizeKey));
    plans = plans.filter((p) => keys.has(normalizeKey(p.original.name)));
  }

  const describe = (p: MergePlan) => {
    const owner = nameOf(p.original.owner_id!);
    const onTeam = memberships.get(p.original.owner_id!)?.has(p.original.team_id);
    console.log(`\n■ ${p.original.name} — ${owner}`);
    console.log(`    keep:   ${team(p.original.team_id)}${onTeam ? "" : " (owner is not on this team)"}`);
    for (const d of p.duplicates) {
      const trackers = (d.shared_team_ids ?? []).filter((t) => t !== p.original.team_id).map(team);
      console.log(
        `    delete: ${team(d.team_id)} copy${d.team_id === p.original.team_id ? " (same team — no share needed)" : ` → ${team(d.team_id)} tracks the original`}${trackers.length ? `; its trackers move over: ${trackers.join(", ")}` : ""}`,
      );
    }
    if (p.fill.size) console.log(`    adds ${p.fill.size} week(s) to the original: ${[...p.fill.keys()].sort().join(", ")}`);
    if (!p.original.is_public) console.log("    original becomes public (needed for other teams to track it)");
    if (p.disagreements.length) {
      console.log(`    ${p.disagreements.length} week(s) with different numbers${p.status === "ready" ? " — original's kept" : ""}:`);
      for (const d of p.disagreements.slice(0, 8)) {
        console.log(`      ${d.week}: original ${d.original}, ${team(p.duplicates.find((x) => x.id === d.duplicateId)!.team_id)} ${d.duplicate}`);
      }
      if (p.disagreements.length > 8) console.log(`      … ${p.disagreements.length - 8} more`);
    }
    if (p.fillConflicts.length) console.log(`    copies disagree on weeks the original lacks: ${p.fillConflicts.join(", ")}`);
  };

  const ready = plans.filter((p) => p.status === "ready");
  const held = plans.filter((p) => p.status !== "ready");
  console.log(`\n${ready.length} to merge (${ready.reduce((n, p) => n + p.duplicates.length, 0)} duplicates deleted):`);
  ready.forEach(describe);
  if (held.length) {
    console.log(`\n\n${held.length} held back:`);
    for (const p of held) {
      console.log(
        `\n[${
          p.status === "differs"
            ? "numbers differ — re-run with --keep-original-numbers to keep the original's"
            : p.status === "app-created"
              ? "a duplicate was made in the app, not imported — re-run with --include-app-created to merge it"
              : p.status === "mismatch"
                ? `may be different measurables — ${p.mismatches.join("; ")}`
                : "copies disagree — fix by hand"
        }]`,
      );
      describe(p);
    }
  }

  if (!opts.apply) {
    console.log("\nDry run — nothing written. Re-run with --apply --actor <uid> to merge.");
    return;
  }

  const rl = opts.yes ? null : createInterface({ input: process.stdin, output: process.stdout });
  let merged = 0;
  const failed: string[] = [];
  for (const [i, p] of ready.entries()) {
    if (rl) {
      const a = (
        await rl.question(
          `\n(${i + 1}/${ready.length}) ${p.original.name} — ${nameOf(p.original.owner_id!)}: keep ${team(p.original.team_id)}, delete ${p.duplicates.map((d) => team(d.team_id)).join(", ")}? [y/n/q] `,
        )
      )
        .trim()
        .toLowerCase();
      if (a === "q") break;
      if (a !== "y") {
        console.log("  skipped");
        continue;
      }
    }
    const result = await applyDuplicateMerge(db, p, opts.actor!);
    if (result.ok) {
      merged++;
      console.log(
        `  ✓ ${p.original.name} — tracked by ${result.tracking.map(team).join(", ") || "no other team"}${result.filled ? `, ${result.filled} week(s) added` : ""}`,
      );
    } else {
      failed.push(p.original.name);
      console.log(`  ✗ ${p.original.name}: ${result.problems.join("; ")}`);
    }
  }
  rl?.close();
  console.log(`\nMerged ${merged}.${failed.length ? ` Failed ${failed.length}: ${failed.join(", ")}` : ""}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
