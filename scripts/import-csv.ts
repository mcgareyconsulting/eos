// CSV importer CLI — seeds real client data into a team from ninety.io-style
// exports (or any spreadsheet with the same columns).
//
// Usage:
//   pnpm import:csv --team "Leadership Team" \
//     --scorecard ~/Downloads/scorecard.csv \
//     --rocks ~/Downloads/rocks.csv \
//     --milestones ~/Downloads/milestones.csv \
//     --dry-run
//
// Core parsing + Firestore writes live in lib/team-import.ts so the in-app
// Import page can share the same engine.

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "../lib/firebase/admin";
import { normalizePersonKey } from "../lib/csv-import";
import { pickSheet, readXlsx } from "../lib/xlsx";
import {
  headlineTablesFromBytes,
  issueTablesFromBytes,
  loadMembers,
  preferRegexForKind,
  runTeamImport,
  tableFromBytes,
  Writer,
  type Member,
  type TeamImportInputs,
} from "../lib/team-import";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

type Args = {
  project?: string;
  database?: string;
  team: string;
  createTeam: boolean;
  leader?: string;
  leaderName?: string;
  members: string[];
  scorecard?: string;
  rocks?: string;
  milestones?: string;
  todos?: string;
  issues?: string;
  headlines?: string;
  scorecardSheet?: string;
  rocksSheet?: string;
  milestonesSheet?: string;
  todosSheet?: string;
  issuesSheet?: string;
  headlinesSheet?: string;
  asOf: Date;
  dryRun: boolean;
  ownerAliases: string[];
  ownerFallback?: string;
  createOwners: boolean;
  includeArchived: boolean;
  completedSince: string | null;
  rockTeam?: string;
};

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, (string | true)[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    const value: string | true =
      next !== undefined && !next.startsWith("--") ? next : true;
    if (typeof value === "string") i++;
    flags.set(key, [...(flags.get(key) ?? []), value]);
  }

  const str = (k: string): string | undefined => {
    const v = flags.get(k)?.at(-1);
    return typeof v === "string" ? v : undefined;
  };
  const list = (k: string): string[] =>
    (flags.get(k) ?? []).filter((v): v is string => typeof v === "string");

  const team = str("team");
  if (!team) {
    console.error(
      "Missing --team. Run `pnpm team:info` to list teams, then:\n" +
        '  pnpm import:csv --team "Leadership Team" --scorecard scorecard.csv --dry-run',
    );
    process.exit(1);
  }

  const asOfRaw = str("as-of");
  const asOf = asOfRaw ? new Date(`${asOfRaw}T00:00:00`) : new Date();
  if (Number.isNaN(asOf.getTime())) {
    console.error(`--as-of must be YYYY-MM-DD (got "${asOfRaw}")`);
    process.exit(1);
  }

  const completedSince = str("completed-since") ?? null;
  if (completedSince && !/^\d{4}-\d{2}-\d{2}$/.test(completedSince)) {
    console.error(`--completed-since must be YYYY-MM-DD (got "${completedSince}")`);
    process.exit(1);
  }

  if (
    !str("scorecard") &&
    !str("rocks") &&
    !str("milestones") &&
    !str("todos") &&
    !str("issues") &&
    !str("headlines")
  ) {
    console.error(
      "Nothing to import — pass at least one of --scorecard / --rocks / --milestones / --todos / --issues / --headlines.",
    );
    process.exit(1);
  }

  return {
    project: str("project"),
    database: str("database"),
    team,
    createTeam: flags.has("create-team"),
    leader: str("leader"),
    leaderName: str("leader-name"),
    members: list("member"),
    scorecard: str("scorecard"),
    rocks: str("rocks"),
    milestones: str("milestones"),
    todos: str("todos"),
    issues: str("issues"),
    headlines: str("headlines"),
    scorecardSheet: str("scorecard-sheet"),
    rocksSheet: str("rocks-sheet"),
    milestonesSheet: str("milestones-sheet"),
    todosSheet: str("todos-sheet"),
    issuesSheet: str("issues-sheet"),
    headlinesSheet: str("headlines-sheet"),
    asOf,
    dryRun: flags.has("dry-run"),
    ownerAliases: list("owner-alias"),
    ownerFallback: str("owner-fallback"),
    createOwners: !flags.has("no-create-owners"),
    includeArchived: flags.has("include-archived"),
    completedSince,
    rockTeam: str("rock-team"),
  };
}

function readFileTable(
  path: string,
  kind: "scorecard" | "rocks" | "milestones" | "todos",
  sheetName?: string,
) {
  const buf = readFileSync(path);
  if (/\.xlsx$/i.test(path)) {
    const sheets = readXlsx(buf);
    const sheet = pickSheet(sheets, sheetName, preferRegexForKind(kind));
    console.log(
      `  reading "${sheet.name}" of ${sheets.length} sheet(s): ${sheets.map((s) => s.name).join(", ")}`,
    );
  }
  const table = tableFromBytes(buf, path, preferRegexForKind(kind), sheetName);
  if (table.rows.length === 0) console.warn(`⚠ ${path} has no data rows.`);
  return table;
}

async function resolveTeam(
  db: ReturnType<typeof getAdminDb>,
  teamArg: string,
  opts: { createTeam: boolean; dryRun: boolean },
): Promise<{ id: string; name: string; created: boolean }> {
  const byId = await db.collection("teams").doc(teamArg).get();
  if (byId.exists) {
    return { id: byId.id, name: (byId.data()?.name as string) ?? teamArg, created: false };
  }

  const byName = await db.collection("teams").where("name", "==", teamArg).get();
  if (byName.size === 1) {
    return {
      id: byName.docs[0].id,
      name: byName.docs[0].data().name as string,
      created: false,
    };
  }
  if (byName.size > 1) {
    console.error(
      `${byName.size} teams named "${teamArg}" — pass the team id instead:\n` +
        byName.docs.map((d) => `  ${d.id}`).join("\n"),
    );
    process.exit(1);
  }

  if (opts.createTeam) {
    const ref = db.collection("teams").doc();
    if (!opts.dryRun) {
      await ref.set({
        name: teamArg,
        org_id: "default",
        parent_team_id: null,
        created_at: FieldValue.serverTimestamp(),
      });
    }
    return { id: ref.id, name: teamArg, created: true };
  }

  const all = await db.collection("teams").get();
  console.error(
    `No team matched "${teamArg}". Pass --create-team to create it, or use one of:\n` +
      all.docs.map((d) => `  • ${d.data().name} (${d.id})`).join("\n"),
  );
  process.exit(1);
}

async function attachAccount(
  teamId: string,
  account: string,
  role: "leader" | "member",
  writer: Writer,
): Promise<Member> {
  const auth = getAdminAuth();
  const onAuthEmulator = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

  let uid = account;
  let user: import("firebase-admin/auth").UserRecord | null = null;
  try {
    user = account.includes("@")
      ? await auth.getUserByEmail(account)
      : await auth.getUser(account);
    uid = user.uid;
  } catch {
    if (account.includes("@") && onAuthEmulator) {
      user = await auth.createUser({ email: account, emailVerified: true });
      uid = user.uid;
      console.log(`Created emulator auth user for "${account}".`);
    } else if (account.includes("@")) {
      console.error(
        `No Firebase Auth user for "${account}" — sign in to the app once, then re-run.\n` +
          `  (Or pass the uid directly if you know it.)`,
      );
      process.exit(1);
    }
  }

  const displayName = user?.displayName ?? user?.email ?? account;
  await writer.set(["users", uid], {
    display_name: displayName,
    email: user?.email ?? (account.includes("@") ? account : null),
    picture: user?.photoURL ?? null,
  });
  await writer.set(["team_members", `${teamId}__${uid}`], {
    team_id: teamId,
    user_id: uid,
    role,
    created_at: FieldValue.serverTimestamp(),
  });

  console.log(
    `${role === "leader" ? "Leader" : "Member"}: ${user?.email ?? account} (uid ${uid})`,
  );
  return {
    user_id: uid,
    names: [displayName, user?.email ?? "", account].filter((n) => n && n.trim() !== ""),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.project) process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = args.project;
  if (args.database !== undefined) process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID = args.database;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  console.log(
    `\nProject: ${projectId ?? "(from credentials)"}   Database: ${databaseId || "(default)"}` +
      (process.env.FIRESTORE_EMULATOR_HOST
        ? `   [EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST}]`
        : ""),
  );

  const db = getAdminDb();

  const team = await resolveTeam(db, args.team, {
    createTeam: args.createTeam,
    dryRun: args.dryRun,
  });
  console.log(
    `\nTarget: "${team.name}" (${team.id})${team.created ? " — NEW TEAM" : ""}` +
      (args.dryRun ? "   [DRY RUN — nothing will be written]" : ""),
  );

  // Pre-attach leader/members so owner matching sees them (even in dry-run).
  const preWriter = new Writer(db, args.dryRun);
  const members = await loadMembers(db, team.id);
  const attach = async (account: string, role: "leader" | "member") => {
    const m = await attachAccount(team.id, account, role, preWriter);
    if (!members.some((existing) => existing.user_id === m.user_id)) members.push(m);
  };
  if (args.leader) await attach(args.leader, "leader");
  for (const m of args.members) await attach(m, "member");
  await preWriter.flush();
  console.log(`Members on this team: ${members.length}`);

  let fallbackId: string | null = null;
  if (args.ownerFallback) {
    const key = normalizePersonKey(args.ownerFallback);
    const match = members.find((m) => m.names.some((n) => normalizePersonKey(n) === key));
    if (!match) {
      console.error(`--owner-fallback "${args.ownerFallback}" is not a member of this team.`);
      process.exit(1);
    }
    fallbackId = match.user_id;
  }

  const aliases = new Map<string, string>();
  for (const raw of args.ownerAliases) {
    const [csvName, target] = raw.split("=").map((s) => s.trim());
    if (!csvName || !target) {
      console.error(`--owner-alias must look like "CSV Name=email-or-uid" (got "${raw}")`);
      process.exit(1);
    }
    const targetKey = normalizePersonKey(target);
    const match = members.find(
      (m) => m.user_id === target || m.names.some((n) => normalizePersonKey(n) === targetKey),
    );
    if (!match) {
      console.error(`--owner-alias target "${target}" is not a member of this team.`);
      process.exit(1);
    }
    aliases.set(normalizePersonKey(csvName), match.user_id);
  }

  const inputs: TeamImportInputs = {};

  if (args.scorecard) {
    inputs.scorecard = {
      table: readFileTable(args.scorecard, "scorecard", args.scorecardSheet),
    };
  }
  if (args.rocks) {
    inputs.rocks = { table: readFileTable(args.rocks, "rocks", args.rocksSheet) };
  }
  if (args.milestones) {
    inputs.milestones = {
      table: readFileTable(args.milestones, "milestones", args.milestonesSheet),
    };
  }
  if (args.todos) {
    inputs.todos = { table: readFileTable(args.todos, "todos", args.todosSheet) };
  }
  if (args.issues) {
    const buf = readFileSync(args.issues);
    if (/\.xlsx$/i.test(args.issues) && !args.issuesSheet) {
      const sheets = readXlsx(buf);
      const prefer = /issue|short.?term|long.?term/i;
      const picked = sheets.filter((s) => prefer.test(s.name));
      const use = picked.length > 0 ? picked : sheets;
      console.log(
        `  reading ${use.length} of ${sheets.length} sheet(s): ${use.map((s) => s.name).join(", ")}` +
          (picked.length === 0 ? " (no issue-named sheets; using all)" : ""),
      );
    }
    inputs.issues = {
      tables: issueTablesFromBytes(buf, args.issues, args.issuesSheet),
    };
  }
  if (args.headlines) {
    const buf = readFileSync(args.headlines);
    if (/\.xlsx$/i.test(args.headlines) && !args.headlinesSheet) {
      const sheets = readXlsx(buf);
      const prefer = /headline|cascad/i;
      const picked = sheets.filter((s) => prefer.test(s.name));
      const use = picked.length > 0 ? picked : sheets;
      console.log(
        `  reading ${use.length} of ${sheets.length} sheet(s): ${use.map((s) => s.name).join(", ")}` +
          (picked.length === 0 ? " (no headline-named sheets; using all)" : ""),
      );
    }
    inputs.headlines = {
      tables: headlineTablesFromBytes(buf, args.headlines, args.headlinesSheet),
    };
  }

  console.log("");
  const report = await runTeamImport(
    db,
    team.id,
    inputs,
    {
      dryRun: args.dryRun,
      createOwners: args.createOwners,
      fallbackOwnerId: fallbackId,
      ownerAliases: aliases,
      includeArchived: args.includeArchived,
      completedSince: args.completedSince,
      rockTeam: args.rockTeam,
      asOf: args.asOf,
    },
    members,
  );

  for (const k of report.kinds) {
    const extra = k.details.length ? `  (${k.details.join("; ")})` : "";
    console.log(
      `  ${k.label}: ${k.imported} imported${k.skipped ? `, ${k.skipped} skipped` : ""}${extra}`,
    );
    for (const w of k.warnings) console.warn(`  ⚠ ${w}`);
  }

  // Promote by name after imports (placeholder may have just been created).
  if (args.leaderName) {
    const postMembers = await loadMembers(db, team.id);
    const key = normalizePersonKey(args.leaderName);
    const match = postMembers.find((m) =>
      m.names.some((n) => normalizePersonKey(n) === key),
    );
    // Also check placeholders created this run.
    const fromReport = report.placeholdersCreated.find(
      (c) => normalizePersonKey(c.name) === key,
    );
    const uid = match?.user_id ?? fromReport?.user_id;
    if (!uid) {
      console.warn(
        `⚠ --leader-name "${args.leaderName}" didn't match any owner in the files or member of the team — no leader set.`,
      );
    } else if (!args.dryRun) {
      await db.collection("team_members").doc(`${team.id}__${uid}`).set(
        {
          team_id: team.id,
          user_id: uid,
          role: "leader",
        },
        { merge: true },
      );
      console.log(`\nLeader: ${args.leaderName} (uid ${uid})`);
    } else {
      console.log(`\nLeader (dry-run): ${args.leaderName} (uid ${uid})`);
    }
  }

  console.log("");
  if (report.placeholdersCreated.length > 0) {
    console.log(
      `Created ${report.placeholdersCreated.length} placeholder member(s) — they show up as team members ` +
        `with no login until the real account signs in:\n` +
        report.placeholdersCreated.map((c) => `  • ${c.name}  (${c.user_id})`).join("\n"),
    );
  }
  if (report.unresolvedOwners.length > 0) {
    console.warn(
      `⚠ Skipped rows for ${report.unresolvedOwners.length} unresolved owner(s): ${report.unresolvedOwners.join(", ")}\n` +
        `  Drop --no-create-owners, or pass --owner-fallback <member> to park them on someone.`,
    );
  }

  console.log(
    args.dryRun
      ? `Dry run complete — ${report.writes} write(s) planned. Re-run without --dry-run to apply.`
      : `Done — ${report.writes} document(s) written.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
