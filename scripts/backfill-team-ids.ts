// Backfill users/{uid}.team_ids from team_members (P14 / decision D2).
//
// The rules check "is the caller on any team this doc is shared into" with one
// get() of the caller's profile + hasAny() on `team_ids`. The app keeps the
// field current on every roster write (lib/firebase/membership.ts); this
// rebuilds it for every profile, so it is safe to re-run at any time.
//
// Dry-run by default: prints every profile whose team_ids would change
// (before → after). Pass --apply to write.
//
// Usage:
//   pnpm users:backfill-team-ids --database hpb-eos-sandbox-db
//   pnpm users:backfill-team-ids --database hpb-eos-sandbox-db --apply
//
// Options:
//   --database <id>  Firestore database id (default: NEXT_PUBLIC_FIREBASE_DATABASE_ID,
//                    else "(default)"). Same flag as scripts/reassign-user.ts.
//   --apply          Write. Without it, nothing is written.
//   --verbose        Also list profiles that are already correct.
//
// Never creates a profile: a uid with team_members rows but no users/{uid}
// doc is reported, not written.

import { config } from "dotenv";
config({ path: ".env.local" });

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { planBackfill, TEAM_IDS_FIELD } from "../lib/firebase/membership";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

const fmt = (ids: string[] | null) => (ids === null ? "(unset)" : `[${ids.join(", ")}]`);

async function main() {
  const databaseId = arg("--database") || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  const apply = has("--apply") && !has("--dry-run");
  const verbose = has("--verbose");

  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "(unset — ADC will pick default)";
  console.log(`\nbackfill-team-ids`);
  console.log(`  projectId : ${projectId}`);
  console.log(`  database  : ${databaseId || "(default)"}`);
  console.log(`  mode      : ${apply ? "APPLY" : "dry-run (pass --apply to write)"}\n`);

  let app: App = getApps()[0]!;
  if (!app) {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    app = json
      ? initializeApp({ credential: cert(JSON.parse(json)) })
      : initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || undefined });
  }
  const db: Firestore = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

  const [users, members] = await Promise.all([
    db.collection("users").get(),
    db.collection("team_members").get(),
  ]);
  const plans = planBackfill(
    users.docs.map((d) => ({ id: d.id, data: d.data() })),
    members.docs.map((d) => d.data()),
  );

  let writes = 0;
  let unchanged = 0;
  let noProfile = 0;
  for (const { uid, plan } of plans) {
    if (plan.kind === "write") {
      writes++;
      console.log(`  write      users/${uid}  ${fmt(plan.before)} → ${fmt(plan.after)}`);
    } else if (plan.kind === "unchanged") {
      unchanged++;
      if (verbose) console.log(`  ok         users/${uid}  ${fmt(plan.after)}`);
    } else {
      noProfile++;
      console.log(
        `  no-profile users/${uid}  on ${fmt(plan.after)} but has no users doc — not written`,
      );
    }
  }

  console.log(
    `\n${users.size} profile(s), ${members.size} membership(s): ` +
      `${writes} to write, ${unchanged} already correct, ${noProfile} rostered without a profile.`,
  );

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  let batch = db.batch();
  let n = 0;
  for (const { uid, plan } of plans) {
    if (plan.kind !== "write") continue;
    batch.set(db.collection("users").doc(uid), { [TEAM_IDS_FIELD]: plan.after }, { merge: true });
    if (++n >= 400) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  console.log(`\n✓ Wrote team_ids on ${writes} profile(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
