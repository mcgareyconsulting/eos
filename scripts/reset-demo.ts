// Consolidate to a single demo team named `canonicalName`.
//
// Picks the team (among the account's memberships) that holds the MOST data,
// renames it to the canonical name, ensures the account is its leader, and
// detaches the account from every other team — so the app sidebar shows exactly
// one team with all the seeded data. Non-destructive: it renames + removes only
// YOUR membership rows; it never deletes a team or its data.
//
// Usage:
//   pnpm tsx scripts/reset-demo.ts <login-email-or-uid> ["Canonical Team Name"]

import { config } from "dotenv";
config({ path: ".env.local" });

import { FieldValue } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb, getAdminAuth } from "../lib/firebase/admin";

const DEFAULT_CANONICAL = "Demo Team";
const DATA_COLLECTIONS = [
  "rocks",
  "issues",
  "todos",
  "scorecard_metrics",
  "headlines",
  "meetings",
] as const;

async function dataScore(db: Firestore, teamId: string): Promise<number> {
  let n = 0;
  for (const col of DATA_COLLECTIONS) {
    n += (await db.collection(col).where("team_id", "==", teamId).get()).size;
  }
  return n;
}

async function emailOf(auth: Auth, uid: string): Promise<string> {
  if (uid.startsWith("demo-")) return `${uid} (synthetic)`;
  try {
    return (await auth.getUser(uid)).email ?? uid;
  } catch {
    return `${uid} (no auth user)`;
  }
}

async function main() {
  const account = process.argv[2];
  const canonicalName = process.argv[3] || DEFAULT_CANONICAL;
  if (!account) {
    console.error(
      'Usage: pnpm tsx scripts/reset-demo.ts <login-email-or-uid> ["Canonical Team Name"]',
    );
    process.exit(1);
  }

  const db = getAdminDb();
  const auth = getAdminAuth();

  let uid = account;
  try {
    uid = account.includes("@")
      ? (await auth.getUserByEmail(account)).uid
      : (await auth.getUser(account)).uid;
  } catch {
    if (account.includes("@")) {
      console.error(`No Firebase Auth user with email "${account}".`);
      process.exit(1);
    }
  }

  const mine = await db
    .collection("team_members")
    .where("user_id", "==", uid)
    .get();
  const teamIds = [...new Set(mine.docs.map((d) => d.data().team_id as string))];

  // Choose the canonical team: the membership team holding the most data.
  let canonicalId: string;
  if (teamIds.length === 0) {
    const ref = db.collection("teams").doc();
    await ref.set({
      name: canonicalName,
      org_id: "default",
      parent_team_id: null,
      created_at: FieldValue.serverTimestamp(),
    });
    canonicalId = ref.id;
    console.log(
      `No existing teams — created "${canonicalName}" (${canonicalId}). Run \`pnpm seed ${account}\` to fill it.`,
    );
  } else {
    const scored: { id: string; score: number }[] = [];
    for (const id of teamIds) scored.push({ id, score: await dataScore(db, id) });
    scored.sort((a, b) => b.score - a.score);
    canonicalId = scored[0].id;
    await db.collection("teams").doc(canonicalId).update({ name: canonicalName });
    console.log(
      `Kept the richest team (${canonicalId}, ${scored[0].score} records) and renamed it "${canonicalName}".`,
    );
  }

  // Ensure leader on the canonical team.
  await db
    .collection("team_members")
    .doc(`${canonicalId}__${uid}`)
    .set(
      {
        team_id: canonicalId,
        user_id: uid,
        role: "leader",
        created_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  // Detach from every other team.
  const detached: string[] = [];
  for (const m of mine.docs) {
    const tid = m.data().team_id as string;
    if (tid === canonicalId) continue;
    await m.ref.delete();
    detached.push(tid);
  }

  console.log(
    `\n✓ ${account} is now on exactly one team: "${canonicalName}" (${canonicalId}).`,
  );
  if (detached.length) {
    console.log(`Detached your membership from ${detached.length} other team(s):`);
    for (const tid of [...new Set(detached)]) {
      const t = await db.collection("teams").doc(tid).get();
      const remaining = await db
        .collection("team_members")
        .where("team_id", "==", tid)
        .get();
      const realRemaining = remaining.docs
        .map((d) => d.data().user_id as string)
        .filter((id) => !id.startsWith("demo-"));
      const emails: string[] = [];
      for (const id of realRemaining) emails.push(await emailOf(auth, id));
      const label =
        realRemaining.length === 0
          ? "ORPHAN — no real members left, safe to delete"
          : `still has ${realRemaining.length} real member(s): ${emails.join(", ")}`;
      console.log(`  • "${t.data()?.name}" (${tid}) — ${label}`);
    }
    console.log(
      "\nThese teams still EXIST with their data — only your membership was removed.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
