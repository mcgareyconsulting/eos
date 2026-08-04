// Merge a CSV-import placeholder uid into a real Google Auth uid on one team.
//
// Typical case: import created `import-steph-benes` for owner "Steph Benes";
// the person later signed in with Google under a different uid. Both sit on
// the roster → double name in speaking order; imported rocks/todos/issues
// stay stuck on the placeholder.
//
// Default is dry-run (prints every write). Pass --apply to commit.
//
// Usage:
//   pnpm tsx scripts/merge-import-user.ts \
//     --from import-steph-benes \
//     --to feBGEk83HEd1fssMOQsnbUweThG3 \
//     --team VSI5aSuR45v55WKqthA5 \
//     --database hpb-eos-prod-db
//
//   pnpm tsx scripts/merge-import-user.ts ... --apply
//
// Safe operations only:
//   • owner_id reassignment on rocks / todos / issues / scorecard_metrics
//   • remove `from` from teams.speaking_order and LIVE meetings' speaking_order
//     / absent_user_ids (adjusting speaking_index so the pointer stays on the
//     same person; never inserts `to` as absent). Ended meetings keep their
//     as-run rotation untouched.
//   • delete team_members/{team}__{from}; delete users/{from} only when no
//     other team's membership still references it
// Does NOT delete Auth (placeholder has none) or touch unrelated teams.
//
// Refuses to run unless `from` looks like an import placeholder (id prefix /
// created_via marker, and no Firebase Auth record). --force overrides.

import { config } from "dotenv";
config({ path: ".env.local" });

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { clampSpeakerIndex } from "../lib/l10/speaking-order";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function stripUid(arr: unknown, from: string): string[] | null {
  if (!Array.isArray(arr)) return null;
  const next = arr.filter((x) => x !== from) as string[];
  if (next.length === arr.length) return null;
  return next;
}

async function main() {
  const from = arg("--from");
  const to = arg("--to");
  const teamId = arg("--team");
  const databaseId =
    arg("--database") || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  const apply = has("--apply");
  const force = has("--force");

  if (!from || !to || !teamId) {
    console.error(
      "Required: --from <import-uid> --to <real-uid> --team <teamId>\n" +
        "Optional: --database <id>  --apply  --force",
    );
    process.exit(1);
  }
  if (from === to) {
    console.error("--from and --to must differ");
    process.exit(1);
  }

  let app = getApps()[0];
  if (!app) {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    app = json
      ? initializeApp({ credential: cert(JSON.parse(json)) })
      : initializeApp({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        });
  }
  const db: Firestore = databaseId
    ? getFirestore(app, databaseId)
    : getFirestore(app);

  console.log(`\nMerge import user → real user`);
  console.log(`  database : ${databaseId || "(default)"}`);
  console.log(`  team     : ${teamId}`);
  console.log(`  from     : ${from}`);
  console.log(`  to       : ${to}`);
  console.log(`  mode     : ${apply ? "APPLY (writes)" : "DRY-RUN (no writes)"}\n`);

  // Preconditions
  //
  // `from` must actually be an import placeholder. import-csv.ts creates them
  // with an `import-` id prefix and `created_via: "csv-import"` on users/{id},
  // and never creates an Auth record. A swapped --from/--to would otherwise
  // hand the real user's data to the placeholder and delete the real user's
  // membership + profile.
  const fromUser = await db.collection("users").doc(from).get();
  const hasImportMarker =
    from.startsWith("import-") || fromUser.data()?.created_via === "csv-import";
  let authRecord: "none" | "exists" | "unknown" = "unknown";
  try {
    await getAuth(app).getUser(from);
    authRecord = "exists";
  } catch (err) {
    if ((err as { code?: string })?.code === "auth/user-not-found") {
      authRecord = "none";
    } else {
      console.warn(
        `Auth lookup for ${from} failed (${(err as Error).message}); ` +
          "falling back to id/field markers only.",
      );
    }
  }
  if (!hasImportMarker || authRecord === "exists") {
    const reasons = [
      !hasImportMarker &&
        `no import marker (id lacks "import-" prefix and users/${from} has no created_via: "csv-import")`,
      authRecord === "exists" &&
        `${from} HAS a Firebase Auth record — placeholders never do`,
    ]
      .filter(Boolean)
      .join("; ");
    if (!force) {
      console.error(
        `--from ${from} does not look like an import placeholder: ${reasons}.\n` +
          "Refusing to merge — check that --from/--to are not swapped.\n" +
          "Pass --force only if you are certain.",
      );
      process.exit(1);
    }
    console.warn(
      `\n*** --force: proceeding although --from ${from} does not look like an ` +
        `import placeholder (${reasons}). This will reassign ${from}'s data ` +
        `and DELETE its membership and profile. ***\n`,
    );
  }

  const fromMember = await db
    .collection("team_members")
    .doc(`${teamId}__${from}`)
    .get();
  const toMember = await db
    .collection("team_members")
    .doc(`${teamId}__${to}`)
    .get();
  if (!fromMember.exists) {
    console.error(`No membership ${teamId}__${from} — nothing to merge.`);
    process.exit(1);
  }
  if (!toMember.exists) {
    console.error(
      `Real uid is not on this team (${teamId}__${to}). Add them first.`,
    );
    process.exit(1);
  }

  type Op =
    | { kind: "update"; path: string; patch: Record<string, unknown> }
    | { kind: "delete"; path: string };

  const ops: Op[] = [];

  // 1) Reassign owner_id on owned entities (team-scoped scan + field match).
  const ownerCollections = [
    "rocks",
    "todos",
    "issues",
    "scorecard_metrics",
  ] as const;
  for (const col of ownerCollections) {
    const snap = await db
      .collection(col)
      .where("team_id", "==", teamId)
      .where("owner_id", "==", from)
      .get();
    for (const d of snap.docs) {
      const title = (d.data().title || d.data().name || d.id) as string;
      ops.push({
        kind: "update",
        path: `${col}/${d.id}`,
        patch: { owner_id: to },
      });
      console.log(`  owner_id  ${col}/${d.id}  (${String(title).slice(0, 70)})`);
    }
  }

  // 2) created_by on headlines (if any)
  {
    const snap = await db
      .collection("headlines")
      .where("team_id", "==", teamId)
      .get();
    for (const d of snap.docs) {
      if (d.data().created_by === from) {
        ops.push({
          kind: "update",
          path: `headlines/${d.id}`,
          patch: { created_by: to },
        });
        console.log(`  created_by headlines/${d.id}`);
      }
    }
  }

  // 3) rock_status_updates.user_id
  {
    const snap = await db.collection("rock_status_updates").get();
    for (const d of snap.docs) {
      const x = d.data();
      if (x.user_id === from && x.team_id === teamId) {
        ops.push({
          kind: "update",
          path: `rock_status_updates/${d.id}`,
          patch: { user_id: to },
        });
        console.log(`  user_id   rock_status_updates/${d.id}`);
      }
    }
  }

  // 4) Team speaking_order — drop `from` (keep `to` once)
  {
    const ref = db.collection("teams").doc(teamId);
    const snap = await ref.get();
    const so = snap.data()?.speaking_order;
    const next = stripUid(so, from);
    if (next) {
      ops.push({
        kind: "update",
        path: `teams/${teamId}`,
        patch: { speaking_order: next },
      });
      console.log(
        `  speaking_order teams/${teamId}: ${Array.isArray(so) ? so.length : 0} → ${next.length}`,
      );
    }
  }

  // 5) Meetings: speaking_order + absent_user_ids (remove from; do not force to absent)
  {
    const snap = await db
      .collection("meetings")
      .where("team_id", "==", teamId)
      .get();
    for (const d of snap.docs) {
      const x = d.data();
      // Finished meetings record the rotation they actually used
      // (lib/l10/speaking-order.ts) — leave their speaking_order /
      // speaking_index / absent_user_ids as-run.
      if (x.ended_at != null) {
        console.log(`  meeting   meetings/${d.id}  skipped (ended)`);
        continue;
      }
      const patch: Record<string, unknown> = {};
      const so = stripUid(x.speaking_order, from);
      if (so) {
        patch.speaking_order = so;
        // Keep speaking_index on the same person: each removal before the
        // pointer shifts it left by one; a removal AT the pointer leaves it
        // aimed at the next speaker. Clamp with the app's clampSpeakerIndex
        // (out-of-range pins to the last slot, empty order to 0).
        const prev = x.speaking_order as unknown[];
        const rawIdx =
          typeof x.speaking_index === "number" ? x.speaking_index : 0;
        const idx = clampSpeakerIndex(rawIdx, prev.length);
        const removedBefore = prev
          .slice(0, idx)
          .filter((u) => u === from).length;
        const nextIdx = clampSpeakerIndex(idx - removedBefore, so.length);
        if (nextIdx !== x.speaking_index) patch.speaking_index = nextIdx;
      }
      const absent = stripUid(x.absent_user_ids, from);
      if (absent) patch.absent_user_ids = absent;
      if (Object.keys(patch).length) {
        ops.push({ kind: "update", path: `meetings/${d.id}`, patch });
        console.log(
          `  meeting   meetings/${d.id}  fields=${Object.keys(patch).join(",")}`,
        );
      }
    }
  }

  // 6) Drop placeholder membership + profile
  ops.push({
    kind: "delete",
    path: `team_members/${teamId}__${from}`,
  });
  console.log(`  delete    team_members/${teamId}__${from}`);

  // users/{from} is global — only delete it once no other team's membership
  // still references the placeholder.
  const otherMemberships = (
    await db.collection("team_members").where("user_id", "==", from).get()
  ).docs.filter((d) => d.id !== `${teamId}__${from}`);
  if (otherMemberships.length > 0) {
    console.log(
      `  keep      users/${from} — still referenced by ${otherMemberships.length} ` +
        `other team(s): ${otherMemberships
          .map((d) => String(d.data().team_id ?? d.id))
          .join(", ")} (the last merge will remove it)`,
    );
  } else if (fromUser.exists) {
    ops.push({ kind: "delete", path: `users/${from}` });
    console.log(`  delete    users/${from}`);
  }

  console.log(`\n${ops.length} operation(s) planned.`);

  if (!apply) {
    console.log(
      "\nDry-run only. Re-run with --apply to write these changes to Firestore.",
    );
    return;
  }

  // Apply in batches of 400
  let batch = db.batch();
  let n = 0;
  const commit = async () => {
    if (n === 0) return;
    await batch.commit();
    batch = db.batch();
    n = 0;
  };

  for (const op of ops) {
    const [col, ...rest] = op.path.split("/");
    const id = rest.join("/");
    const ref = db.collection(col!).doc(id);
    if (op.kind === "update") batch.update(ref, op.patch);
    else batch.delete(ref);
    if (++n >= 400) await commit();
  }
  await commit();
  console.log("\nApplied successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
