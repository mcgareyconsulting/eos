// Promote / demote a team member's role (leader | member).
//
// Usage:
//   pnpm tsx scripts/set-member-role.ts \
//     --team "Enterprise Systems & Data" \
//     --name "Brian" \
//     --role leader
//
// Match is case-insensitive against display_name, "First Last", first_name,
// email, or uid. Pass --email to pin a specific account. Dry-run by default;
// add --apply to write.

import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminDb } from "../lib/firebase/admin";
import { normalizePersonKey } from "../lib/csv-import";

type Args = {
  team: string;
  name?: string;
  email?: string;
  role: "leader" | "member";
  apply: boolean;
  project?: string;
  database?: string;
};

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  const str = (k: string) => {
    const v = flags.get(k);
    return typeof v === "string" ? v : undefined;
  };

  const team = str("team");
  if (!team) {
    console.error(
      'Missing --team. Example:\n  pnpm tsx scripts/set-member-role.ts --team "Enterprise Systems & Data" --name "Brian" --role leader --apply',
    );
    process.exit(1);
  }
  const name = str("name");
  const email = str("email")?.toLowerCase();
  if (!name && !email) {
    console.error("Pass --name \"Brian\" and/or --email brian@…");
    process.exit(1);
  }
  const roleRaw = (str("role") ?? "leader").toLowerCase();
  if (roleRaw !== "leader" && roleRaw !== "member") {
    console.error('--role must be "leader" or "member"');
    process.exit(1);
  }

  return {
    team,
    name,
    email,
    role: roleRaw,
    apply: flags.has("apply"),
    project: str("project"),
    database: str("database"),
  };
}

async function resolveTeam(db: FirebaseFirestore.Firestore, teamArg: string) {
  const byId = await db.collection("teams").doc(teamArg).get();
  if (byId.exists) {
    return { id: byId.id, name: (byId.data()?.name as string) ?? teamArg };
  }
  const byName = await db.collection("teams").where("name", "==", teamArg).get();
  if (byName.size === 1) {
    return {
      id: byName.docs[0].id,
      name: byName.docs[0].data().name as string,
    };
  }
  if (byName.size > 1) {
    console.error(
      `${byName.size} teams named "${teamArg}" — pass the team id:\n` +
        byName.docs.map((d) => `  ${d.id}`).join("\n"),
    );
    process.exit(1);
  }
  console.error(`No team matched "${teamArg}". Run pnpm team:info to list teams.`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.project) process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = args.project;
  if (args.database !== undefined) {
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID = args.database;
  }

  const db = getAdminDb();
  const team = await resolveTeam(db, args.team);
  console.log(
    `\nTeam: "${team.name}" (${team.id})` +
      (args.apply ? "" : "   [DRY RUN — pass --apply to write]"),
  );

  const membersSnap = await db
    .collection("team_members")
    .where("team_id", "==", team.id)
    .get();
  if (membersSnap.empty) {
    console.error("No members on this team.");
    process.exit(1);
  }

  const userIds = membersSnap.docs.map((d) => d.data().user_id as string);
  const userDocs = await db.getAll(
    ...userIds.map((id) => db.collection("users").doc(id)),
  );

  type Row = {
    userId: string;
    memberDocId: string;
    role: string;
    display: string;
    first: string;
    last: string;
    email: string;
  };

  const rows: Row[] = userIds.map((userId, i) => {
    const data = userDocs[i]?.data() ?? {};
    const first = (data.first_name as string) ?? "";
    const last = (data.last_name as string) ?? "";
    const email = ((data.email as string) ?? "").toLowerCase();
    const display =
      (data.display_name as string) ||
      `${first} ${last}`.trim() ||
      email ||
      userId;
    const memberDoc = membersSnap.docs.find((d) => d.data().user_id === userId)!;
    return {
      userId,
      memberDocId: memberDoc.id,
      role: (memberDoc.data().role as string) ?? "member",
      display,
      first,
      last,
      email,
    };
  });

  const nameKey = args.name ? normalizePersonKey(args.name) : "";
  const matches = rows.filter((r) => {
    if (args.email && r.email === args.email) return true;
    if (!nameKey) return false;
    const keys = [
      normalizePersonKey(r.display),
      normalizePersonKey(`${r.first} ${r.last}`),
      normalizePersonKey(r.first),
      normalizePersonKey(r.last),
      normalizePersonKey(r.email),
      r.userId,
    ];
    return keys.includes(nameKey) || keys.some((k) => k.split(" ").includes(nameKey));
  });

  if (matches.length === 0) {
    console.error(
      `No member matched${args.name ? ` name "${args.name}"` : ""}${args.email ? ` email "${args.email}"` : ""}. Roster:`,
    );
    for (const r of rows) {
      console.error(`  • ${r.display}  role=${r.role}  ${r.email || r.userId}`);
    }
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error("Ambiguous match — pass --email to pin one:");
    for (const r of matches) {
      console.error(`  • ${r.display}  ${r.email || r.userId}  role=${r.role}`);
    }
    process.exit(1);
  }

  const m = matches[0];
  console.log(
    `\n  ${m.display}${m.email ? ` <${m.email}>` : ""}\n` +
      `  uid ${m.userId}\n` +
      `  role: ${m.role} → ${args.role}`,
  );

  if (m.role === args.role) {
    console.log("\nAlready that role — nothing to do.");
    return;
  }

  if (!args.apply) {
    console.log("\nDry run complete. Re-run with --apply to write.");
    return;
  }

  await db.collection("team_members").doc(m.memberDocId).set(
    {
      team_id: team.id,
      user_id: m.userId,
      role: args.role,
    },
    { merge: true },
  );
  console.log("\nUpdated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
