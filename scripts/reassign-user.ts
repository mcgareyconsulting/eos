// Reassign all EOS data from one uid to another (real Auth, or orphaned
// Firestore-only identity after Auth was deleted).
//
// Typical case: consultant switched Google accounts
//   mcgareyconsulting@gmail.com  →  daniel@mcgareyconsulting.com
// Private to-dos (and every other owner_id) stay on the old uid, so the new
// login cannot see them. This script rewrites ownership + memberships.
//
// **From may have no Auth record** (deleted in Console). Resolve via:
//   --from-uid <oldUid>   OR   --from-email (looks up users/{uid} by email)
// **To must still exist in Firebase Auth** (you sign in as them).
//
// Dry-run by default. Pass --apply to write.
//
// Usage (Auth deleted for old email — preferred):
//   pnpm tsx scripts/reassign-user.ts \
//     --from-uid OLD_UID_FROM_FIRESTORE \
//     --to-email daniel@mcgareyconsulting.com \
//     --database hpb-eos-sandbox-db
//
// Usage (both still in Auth):
//   pnpm tsx scripts/reassign-user.ts \
//     --from-email old@… --to-email new@… --database hpb-eos-sandbox-db
//
// Optional:
//   --team <teamId>     only one team (default: every team `from` is on)
//   --keep-from-membership  leave old roster rows (default: remove after merge)
//
// Does NOT recreate or delete Auth users. After apply: sign out/in as the new
// account; re-grant admin claim on the new email if needed; reconnect Google
// Tasks under Settings if the connection did not move.

import { config } from "dotenv";
config({ path: ".env.local" });

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";

import { clampSpeakerIndex } from "../lib/l10/speaking-order";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function replaceUidInArray(
  arr: unknown,
  from: string,
  to: string,
): string[] | null {
  if (!Array.isArray(arr)) return null;
  const asStr = arr.filter((x): x is string => typeof x === "string");
  if (!asStr.includes(from)) return null;
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of asStr) {
    const mapped = id === from ? to : id;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    next.push(mapped);
  }
  // Unchanged?
  if (
    next.length === asStr.length &&
    next.every((v, i) => v === asStr[i])
  ) {
    return null;
  }
  return next;
}

type Op =
  | { kind: "update"; path: string; patch: Record<string, unknown> }
  | { kind: "set"; path: string; data: Record<string, unknown> }
  | { kind: "delete"; path: string };

async function main() {
  const fromEmail = arg("--from-email")?.toLowerCase();
  const toEmail = arg("--to-email")?.toLowerCase();
  let fromUid = arg("--from-uid");
  let toUid = arg("--to-uid");
  const teamFilter = arg("--team");
  const databaseId =
    arg("--database") || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  const apply = has("--apply");
  const keepFromMembership = has("--keep-from-membership");

  if ((!fromEmail && !fromUid) || (!toEmail && !toUid)) {
    console.error(
      "Required: --from-email <old> OR --from-uid <oldUid>\n" +
        "      and --to-email <new>   OR --to-uid <newUid>\n" +
        "Optional: --database <id>  --team <teamId>  --apply  --keep-from-membership\n" +
        "\nIf old Auth was deleted, use --from-uid (copy uid from Firestore\n" +
        "users/ or team_members/ user_id). --to must still exist in Auth.",
    );
    process.exit(1);
  }

  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "(unset — ADC will pick default)";
  const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST;
  const useEmulatorFlag = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR;

  console.log(`\nEnvironment (reassign-user)`);
  console.log(`  projectId              : ${projectId}`);
  console.log(`  NEXT_PUBLIC_FIREBASE_DATABASE_ID (env default): ${process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "(unset)"}`);
  console.log(`  --database             : ${databaseId || "(default / env)"}`);
  console.log(`  FIREBASE_AUTH_EMULATOR_HOST : ${authEmulator || "(unset — live Auth)"}`);
  console.log(`  FIRESTORE_EMULATOR_HOST     : ${firestoreEmulator || "(unset — live Firestore)"}`);
  console.log(`  NEXT_PUBLIC_FIREBASE_USE_EMULATOR : ${useEmulatorFlag ?? "(unset)"}`);
  console.log(
    `  credentials            : ${process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? "FIREBASE_SERVICE_ACCOUNT_JSON" : "Application Default Credentials"}`,
  );

  if (authEmulator || firestoreEmulator || useEmulatorFlag === "true") {
    console.error(
      "\n*** Emulator / demo mode is active in this shell's env. ***\n" +
        "Auth lookups will hit the local emulator (or demo project), not hpb-eos-prod.\n" +
        "Fix for this command only:\n" +
        "  unset FIREBASE_AUTH_EMULATOR_HOST FIRESTORE_EMULATOR_HOST\n" +
        "  # and use a .env that points at the real project, e.g.:\n" +
        "  NEXT_PUBLIC_FIREBASE_USE_EMULATOR=false\n" +
        "  NEXT_PUBLIC_FIREBASE_PROJECT_ID=hpb-eos-prod\n" +
        "Or pass a real project via SA JSON for hpb-eos-prod.\n",
    );
    process.exit(1);
  }

  if (
    typeof projectId === "string" &&
    (projectId.startsWith("demo-") || projectId === "(unset — ADC will pick default)")
  ) {
    console.warn(
      `\n⚠ projectId looks wrong for prod ops: ${projectId}\n` +
        "  Set NEXT_PUBLIC_FIREBASE_PROJECT_ID=hpb-eos-prod in .env.local (or export it)\n" +
        "  for this shell before re-running.\n",
    );
  }

  let app: App = getApps()[0]!;
  if (!app) {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    app = json
      ? initializeApp({ credential: cert(JSON.parse(json)) })
      : initializeApp({
          projectId:
            process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || undefined,
        });
  }
  const auth = getAuth(app);
  const db: Firestore = databaseId
    ? getFirestore(app, databaseId)
    : getFirestore(app);

  async function findFirestoreUidsByEmail(email: string): Promise<string[]> {
    const hits = new Set<string>();
    // Exact email field (common on users/ profiles)
    try {
      const snap = await db
        .collection("users")
        .where("email", "==", email)
        .limit(10)
        .get();
      for (const d of snap.docs) hits.add(d.id);
    } catch {
      /* missing index or empty */
    }
    // Case variants
    try {
      const snap = await db
        .collection("users")
        .where("email", "==", email.toLowerCase())
        .limit(10)
        .get();
      for (const d of snap.docs) hits.add(d.id);
    } catch {
      /* ignore */
    }
    return [...hits];
  }

  /** Resolve --from: Auth if present, else Firestore users/ by email (orphan). */
  async function resolveFrom(): Promise<{
    uid: string;
    email: string | null;
    authPresent: boolean;
  }> {
    if (fromUid) {
      try {
        const u = await auth.getUser(fromUid);
        return {
          uid: fromUid,
          email: u.email ?? fromEmail ?? null,
          authPresent: true,
        };
      } catch {
        // Orphan uid — still OK if Firestore has data for it
        const prof = await db.collection("users").doc(fromUid).get();
        const mem = await db
          .collection("team_members")
          .where("user_id", "==", fromUid)
          .limit(1)
          .get();
        if (!prof.exists && mem.empty) {
          console.error(
            `--from-uid ${fromUid} has no Auth record AND no users/ or\n` +
              `team_members rows in database ${databaseId || "(default)"}.\n` +
              `Wrong uid or wrong --database?`,
          );
          process.exit(1);
        }
        const email =
          (prof.data()?.email as string | undefined) ?? fromEmail ?? null;
        console.warn(
          `\n⚠ --from-uid ${fromUid} has NO Firebase Auth record (deleted?).\n` +
            `  Continuing as orphan reassignment from Firestore data only.\n`,
        );
        return { uid: fromUid, email, authPresent: false };
      }
    }

    // --from-email path
    const email = fromEmail!;
    try {
      const u = await auth.getUserByEmail(email);
      return { uid: u.uid, email: u.email ?? email, authPresent: true };
    } catch (err) {
      const code =
        (err as { code?: string }).code ||
        (err as { errorInfo?: { code?: string } }).errorInfo?.code;
      if (code !== "auth/user-not-found") throw err;

      const firestoreHits = await findFirestoreUidsByEmail(email);
      if (firestoreHits.length === 1) {
        console.warn(
          `\n⚠ Auth has no user for ${email} (deleted?).\n` +
            `  Using Firestore users/${firestoreHits[0]} as --from-uid.\n`,
        );
        return {
          uid: firestoreHits[0]!,
          email,
          authPresent: false,
        };
      }
      if (firestoreHits.length > 1) {
        console.error(
          `Auth missing for ${email}, but multiple Firestore users/ docs match:\n` +
            firestoreHits.map((id) => `  ${id}`).join("\n") +
            `\nPass one explicitly: --from-uid <uid>`,
        );
        process.exit(1);
      }
      console.error(
        `\nCannot resolve --from-email ${email}:\n` +
          `  • No Firebase Auth user (expected if you deleted it)\n` +
          `  • No users/{uid} with email==${email} in database ${databaseId || "(default)"}\n` +
          `\nFind the old uid in Console → Firestore → users or team_members,\n` +
          `then re-run with --from-uid <thatUid> --to-email ${toEmail ?? "…"}\n`,
      );
      process.exit(1);
    }
  }

  /** Resolve --to: must exist in Auth (destination login). */
  async function resolveTo(): Promise<{
    uid: string;
    email: string | null;
  }> {
    if (toUid) {
      try {
        const u = await auth.getUser(toUid);
        return { uid: toUid, email: u.email ?? toEmail ?? null };
      } catch {
        console.error(
          `--to-uid ${toUid} is not in Firebase Auth.\n` +
            `  Sign in once as the NEW account, or create the user in Console.`,
        );
        process.exit(1);
      }
    }
    try {
      const u = await auth.getUserByEmail(toEmail!);
      return { uid: u.uid, email: u.email ?? toEmail! };
    } catch (err) {
      const code =
        (err as { code?: string }).code ||
        (err as { errorInfo?: { code?: string } }).errorInfo?.code;
      if (code === "auth/user-not-found") {
        console.error(
          `--to-email ${toEmail} is not in Firebase Auth for project ${projectId}.\n` +
            `  Sign in to the app once as that email, then retry.`,
        );
        process.exit(1);
      }
      throw err;
    }
  }

  const fromResolved = await resolveFrom();
  const toResolved = await resolveTo();
  fromUid = fromResolved.uid;
  toUid = toResolved.uid;

  if (fromUid === toUid) {
    console.error("--from and --to resolve to the same uid");
    process.exit(1);
  }

  // toAuth-shaped object for later (email on google_tasks_connections, etc.)
  const toAuth = {
    email: toResolved.email,
    uid: toUid,
  };

  console.log(`\nReassign user (Firestore data → live Auth account)`);
  console.log(`  database : ${databaseId || "(default)"}`);
  console.log(
    `  from     : ${fromResolved.email ?? "(no email)"}  uid=${fromUid}` +
      (fromResolved.authPresent ? "" : "  [Auth deleted — orphan]"),
  );
  console.log(`  to       : ${toAuth.email ?? "(no email)"}  uid=${toUid}`);
  console.log(`  teams    : ${teamFilter ?? "all teams from is on"}`);
  console.log(
    `  mode     : ${apply ? "APPLY (writes)" : "DRY-RUN (no writes)"}\n`,
  );

  const fromMemberships = await db
    .collection("team_members")
    .where("user_id", "==", fromUid)
    .get();

  let teamIds = fromMemberships.docs.map((d) => d.data().team_id as string);
  if (teamFilter) {
    if (!teamIds.includes(teamFilter)) {
      console.error(
        `from uid is not on team ${teamFilter}. Memberships: ${teamIds.join(", ") || "none"}`,
      );
      process.exit(1);
    }
    teamIds = [teamFilter];
  }

  if (teamIds.length === 0) {
    console.warn(
      "from user has no team_members rows. Will still scan global owner_id fields for this uid.",
    );
  } else {
    console.log(`Teams to process (${teamIds.length}): ${teamIds.join(", ")}\n`);
  }

  const ops: Op[] = [];
  const log = (msg: string) => console.log(`  ${msg}`);

  // --- 1) owner_id on domain collections (per team when possible) -----------
  const ownerCols = [
    "rocks",
    "todos",
    "issues",
    "scorecard_metrics",
  ] as const;

  for (const col of ownerCols) {
    if (teamIds.length === 0) {
      const snap = await db
        .collection(col)
        .where("owner_id", "==", fromUid)
        .get();
      for (const d of snap.docs) {
        const title = String(d.data().title || d.data().name || d.id);
        ops.push({
          kind: "update",
          path: `${col}/${d.id}`,
          patch: { owner_id: toUid },
        });
        log(`owner_id  ${col}/${d.id}  (${title.slice(0, 60)})`);
      }
    } else {
      for (const teamId of teamIds) {
        const snap = await db
          .collection(col)
          .where("team_id", "==", teamId)
          .where("owner_id", "==", fromUid)
          .get();
        for (const d of snap.docs) {
          const title = String(d.data().title || d.data().name || d.id);
          ops.push({
            kind: "update",
            path: `${col}/${d.id}`,
            patch: { owner_id: toUid },
          });
          log(
            `owner_id  ${col}/${d.id}  team=${teamId}  (${title.slice(0, 50)})`,
          );
        }
      }
    }
  }

  // --- 2) headlines.created_by ----------------------------------------------
  {
    const snap = teamIds.length
      ? (
          await Promise.all(
            teamIds.map((teamId) =>
              db.collection("headlines").where("team_id", "==", teamId).get(),
            ),
          )
        ).flatMap((s) => s.docs)
      : (await db.collection("headlines").get()).docs;
    for (const d of snap) {
      if (d.data().created_by === fromUid) {
        ops.push({
          kind: "update",
          path: `headlines/${d.id}`,
          patch: { created_by: toUid },
        });
        log(`created_by headlines/${d.id}`);
      }
    }
  }

  // --- 3) entity_comments.author_id -----------------------------------------
  {
    const snap = await db
      .collection("entity_comments")
      .where("author_id", "==", fromUid)
      .get();
    for (const d of snap.docs) {
      const teamId = d.data().team_id as string | undefined;
      if (teamFilter && teamId !== teamFilter) continue;
      if (teamIds.length && teamId && !teamIds.includes(teamId)) continue;
      ops.push({
        kind: "update",
        path: `entity_comments/${d.id}`,
        patch: { author_id: toUid },
      });
      log(`author_id entity_comments/${d.id}`);
    }
  }

  // --- 4) rock_status_updates.user_id ---------------------------------------
  {
    const snap = await db.collection("rock_status_updates").get();
    for (const d of snap.docs) {
      const x = d.data();
      if (x.user_id !== fromUid) continue;
      if (teamFilter && x.team_id !== teamFilter) continue;
      if (teamIds.length && x.team_id && !teamIds.includes(x.team_id)) continue;
      ops.push({
        kind: "update",
        path: `rock_status_updates/${d.id}`,
        patch: { user_id: toUid },
      });
      log(`user_id rock_status_updates/${d.id}`);
    }
  }

  // --- 5) issue_votes: doc id is issueId__userId ----------------------------
  {
    const voteDocs = teamIds.length
      ? (
          await Promise.all(
            teamIds.map((teamId) =>
              db
                .collection("issue_votes")
                .where("team_id", "==", teamId)
                .get(),
            ),
          )
        ).flatMap((s) => s.docs)
      : (await db.collection("issue_votes").get()).docs;
    for (const d of voteDocs) {
      const x = d.data();
      if (x.user_id !== fromUid) continue;
      const issueId = x.issue_id as string;
      const newId = `${issueId}__${toUid}`;
      const existingTo = await db.collection("issue_votes").doc(newId).get();
      if (existingTo.exists) {
        // Merge counts onto the new account's vote row, drop old.
        const toCount = Number(existingTo.data()?.count ?? 0);
        const fromCount = Number(x.count ?? 0);
        ops.push({
          kind: "update",
          path: `issue_votes/${newId}`,
          patch: { count: toCount + fromCount },
        });
        ops.push({ kind: "delete", path: `issue_votes/${d.id}` });
        log(
          `issue_votes merge ${d.id} → ${newId}  counts ${fromCount}+${toCount}`,
        );
      } else {
        ops.push({
          kind: "set",
          path: `issue_votes/${newId}`,
          data: { ...x, user_id: toUid },
        });
        ops.push({ kind: "delete", path: `issue_votes/${d.id}` });
        log(`issue_votes move ${d.id} → ${newId}`);
      }
    }
  }

  // --- 6) teams.speaking_order ----------------------------------------------
  for (const teamId of teamIds) {
    const ref = db.collection("teams").doc(teamId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const so = snap.data()?.speaking_order;
    const next = replaceUidInArray(so, fromUid, toUid);
    if (next) {
      ops.push({
        kind: "update",
        path: `teams/${teamId}`,
        patch: { speaking_order: next },
      });
      log(`speaking_order teams/${teamId}`);
    }
    // meeting_driver_id
    if (snap.data()?.meeting_driver_id === fromUid) {
      ops.push({
        kind: "update",
        path: `teams/${teamId}`,
        patch: { meeting_driver_id: toUid },
      });
      log(`meeting_driver_id teams/${teamId}`);
    }
  }

  // --- 7) meetings speaking / absent + effectiveness_scores -----------------
  for (const teamId of teamIds) {
    const snap = await db
      .collection("meetings")
      .where("team_id", "==", teamId)
      .get();
    for (const d of snap.docs) {
      const x = d.data();
      // Live meetings only for rotation rewrite (same as merge-import-user).
      if (x.ended_at == null) {
        const patch: Record<string, unknown> = {};
        const so = replaceUidInArray(x.speaking_order, fromUid, toUid);
        if (so) {
          patch.speaking_order = so;
          const prev = (x.speaking_order as string[]) ?? [];
          const rawIdx =
            typeof x.speaking_index === "number" ? x.speaking_index : 0;
          const idx = clampSpeakerIndex(rawIdx, prev.length);
          // If current speaker was from, keep index pointing at same slot
          // after replace (to is already at that position).
          const nextIdx = clampSpeakerIndex(idx, so.length);
          if (nextIdx !== x.speaking_index) patch.speaking_index = nextIdx;
        }
        const absent = replaceUidInArray(x.absent_user_ids, fromUid, toUid);
        if (absent) patch.absent_user_ids = absent;
        if (Object.keys(patch).length) {
          ops.push({ kind: "update", path: `meetings/${d.id}`, patch });
          log(
            `meeting meetings/${d.id}  fields=${Object.keys(patch).join(",")}`,
          );
        }
      }

      // effectiveness_scores/{uid}
      const scoreRef = db
        .collection("meetings")
        .doc(d.id)
        .collection("effectiveness_scores")
        .doc(fromUid);
      const scoreSnap = await scoreRef.get();
      if (scoreSnap.exists) {
        const toScoreRef = db
          .collection("meetings")
          .doc(d.id)
          .collection("effectiveness_scores")
          .doc(toUid);
        const toExists = (await toScoreRef.get()).exists;
        if (toExists) {
          ops.push({
            kind: "delete",
            path: `meetings/${d.id}/effectiveness_scores/${fromUid}`,
          });
          log(
            `effectiveness_scores drop from (to already rated) meetings/${d.id}`,
          );
        } else {
          const data = scoreSnap.data() ?? {};
          ops.push({
            kind: "set",
            path: `meetings/${d.id}/effectiveness_scores/${toUid}`,
            data: { ...data, user_id: toUid },
          });
          ops.push({
            kind: "delete",
            path: `meetings/${d.id}/effectiveness_scores/${fromUid}`,
          });
          log(`effectiveness_scores move meetings/${d.id}`);
        }
      }
    }
  }

  // --- 8) team_members ------------------------------------------------------
  for (const teamId of teamIds) {
    const fromMemId = `${teamId}__${fromUid}`;
    const toMemId = `${teamId}__${toUid}`;
    const fromMem = await db.collection("team_members").doc(fromMemId).get();
    if (!fromMem.exists) continue;
    const toMem = await db.collection("team_members").doc(toMemId).get();
    const fromData = fromMem.data() ?? {};

    if (!toMem.exists) {
      ops.push({
        kind: "set",
        path: `team_members/${toMemId}`,
        data: {
          ...fromData,
          user_id: toUid,
          team_id: teamId,
        },
      });
      log(`membership create team_members/${toMemId}`);
    } else {
      log(`membership keep existing team_members/${toMemId}`);
    }

    if (!keepFromMembership) {
      ops.push({ kind: "delete", path: `team_members/${fromMemId}` });
      log(`membership delete team_members/${fromMemId}`);
    }
  }

  // --- 9) users profile: ensure `to` has a profile; leave `from` profile ----
  {
    const fromProf = await db.collection("users").doc(fromUid).get();
    const toProf = await db.collection("users").doc(toUid).get();
    if (!toProf.exists && fromProf.exists) {
      const data = fromProf.data() ?? {};
      ops.push({
        kind: "set",
        path: `users/${toUid}`,
        data: {
          ...data,
          email: toAuth.email ?? data.email ?? null,
          updated_at: FieldValue.serverTimestamp(),
        },
      });
      log(`users profile seed users/${toUid} from old profile`);
    }
  }

  // --- 10) google_tasks_connections -----------------------------------------
  {
    const fromConn = await db
      .collection("google_tasks_connections")
      .doc(fromUid)
      .get();
    const toConn = await db
      .collection("google_tasks_connections")
      .doc(toUid)
      .get();
    if (fromConn.exists && !toConn.exists) {
      const data = fromConn.data() ?? {};
      ops.push({
        kind: "set",
        path: `google_tasks_connections/${toUid}`,
        data: {
          ...data,
          connected_by_uid: toUid,
          connected_email: toAuth.email ?? data.connected_email ?? null,
          updated_at: FieldValue.serverTimestamp(),
        },
      });
      ops.push({
        kind: "delete",
        path: `google_tasks_connections/${fromUid}`,
      });
      log(`google_tasks_connections move ${fromUid} → ${toUid}`);
    } else if (fromConn.exists && toConn.exists) {
      log(
        `google_tasks_connections: both have connections — keeping ${toUid}, leaving ${fromUid} (reconnect under Settings if needed)`,
      );
    }
  }

  console.log(`\n${ops.length} operation(s) planned.`);

  if (!apply) {
    console.log(
      "\nDry-run only. Re-run with --apply to write these changes to Firestore.",
    );
    console.log(
      "After apply: sign out and sign in as the NEW email, then open To-Dos / Home.",
    );
    return;
  }

  let batch = db.batch();
  let n = 0;
  const commit = async () => {
    if (n === 0) return;
    await batch.commit();
    batch = db.batch();
    n = 0;
  };

  for (const op of ops) {
    const parts = op.path.split("/");
    // Support subcollections: meetings/{id}/effectiveness_scores/{uid}
    let ref = db.collection(parts[0]!).doc(parts[1]!);
    for (let i = 2; i + 1 < parts.length; i += 2) {
      ref = ref.collection(parts[i]!).doc(parts[i + 1]!);
    }

    if (op.kind === "update") batch.update(ref, op.patch);
    else if (op.kind === "set") batch.set(ref, op.data, { merge: true });
    else batch.delete(ref);

    if (++n >= 400) await commit();
  }
  await commit();

  console.log("\nApplied successfully.");
  console.log("Next:");
  console.log("  1. Sign out of EOS completely (clears session cookie).");
  console.log(`  2. Sign in as ${toAuth.email}.`);
  console.log("  3. Confirm private to-dos on Home + team To-Dos.");
  console.log(
    "  4. If admin god-mode was on the old account: pnpm admin:set-role --email <new> --apply",
  );
  console.log(
    "  5. Settings → Google Tasks: reconnect if the connection did not move.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
