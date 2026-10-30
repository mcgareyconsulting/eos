// Read-only diagnostic: which rocks Home shows a person, in which section,
// and why — plus the rocks they own that Home leaves out, and any other user
// doc carrying the same name (an import placeholder owning their rocks).
// Touches nothing.
//
// Usage:
//   pnpm home:rocks-why --target prod someone@highplainsbank.com

import "./lib/load-target"; // first: sets up env before anything reads it
import { getAdminAuth, getAdminDb } from "../lib/firebase/admin";
import { rockSubjectOf, rockViewFor } from "../lib/access/rock";
import { viewerOf } from "../lib/access/types";
import { isHomeRockActive, rockHasMyOpenMilestone, shouldShowHomeRock } from "../lib/home-board";
import { rockBucket } from "../lib/rock-bucket";
import { normalizePersonKey } from "../lib/csv-import";

type Rock = Record<string, unknown> & { id: string; team_id: string; owner_id: string | null; title: string };

const SECTION = { company: "Company Rocks", department: "Team Rocks", owner: "My Rocks" } as const;

async function main() {
  const email = process.argv.slice(2).find((a) => a.includes("@"));
  if (!email) throw new Error("Pass the person's email.");
  const db = getAdminDb();
  const authUser = await getAdminAuth().getUserByEmail(email);
  const uid = authUser.uid;
  const isAdmin = authUser.customClaims?.role === "admin";

  const userName = new Map<string, string>();
  const nameFor = async (id: string | null) => {
    if (!id) return "No Owner";
    if (!userName.has(id)) {
      const u = (await db.collection("users").doc(id).get()).data() ?? {};
      userName.set(
        id,
        (u.display_name as string) || [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || (u.email as string) || id,
      );
    }
    return userName.get(id)!;
  };
  const teamName = new Map<string, string>();
  for (const t of (await db.collection("teams").get()).docs) teamName.set(t.id, (t.data().name as string) ?? t.id);

  const memberships = (await db.collection("team_members").where("user_id", "==", uid).get()).docs.map((d) => d.data());
  const teamIds = memberships.map((m) => m.team_id as string);
  const leaderOf = memberships.filter((m) => m.role === "leader").map((m) => m.team_id as string);
  const me = await nameFor(uid);
  console.log(`\n${me} <${email}>  uid ${uid}${isAdmin ? "  (admin claim)" : ""}`);
  console.log(`Teams: ${teamIds.map((id) => teamName.get(id) ?? id).join(", ") || "none"}\n`);

  // The same candidate set Home loads (app/(app)/home/page.tsx).
  const rocks = new Map<string, Rock>();
  const add = (snap: FirebaseFirestore.QuerySnapshot) =>
    snap.docs.forEach((d) => rocks.set(d.id, { ...(d.data() as Omit<Rock, "id">), id: d.id } as Rock));
  for (const teamId of teamIds) {
    add(await db.collection("rocks").where("team_id", "==", teamId).get());
    for (const field of ["audience_team_ids", "shared_team_ids"]) {
      add(await db.collection("rocks").where(field, "array-contains", teamId).get());
    }
  }
  add(await db.collection("rocks").where("audience_user_ids", "array-contains", uid).get());
  const myMilestones = (
    await db.collection("todos").where("owner_id", "==", uid).where("completed_at", "==", null).get()
  ).docs
    .map((d) => ({ id: d.id, ...(d.data() as { owner_id: string | null; completed_at?: unknown }), source_rock_id: (d.data().source_rock_id as string | null) ?? null }))
    .filter((m) => m.source_rock_id);
  const missing = myMilestones.map((m) => m.source_rock_id!).filter((id) => !rocks.has(id));
  if (missing.length) {
    for (const d of await db.getAll(...missing.map((id) => db.collection("rocks").doc(id)))) {
      if (d.exists) rocks.set(d.id, { ...(d.data() as Omit<Rock, "id">), id: d.id } as Rock);
    }
  }

  const viewer = viewerOf(uid, isAdmin, teamIds, leaderOf);
  const myTeamIds = new Set(teamIds);
  const shown: string[] = [];
  const hidden: string[] = [];
  for (const r of rocks.values()) {
    const mine = rockHasMyOpenMilestone(r.id, myMilestones, uid);
    const view = rockViewFor(rockSubjectOf(r), viewer, mine ? [uid] : []);
    const show = shouldShowHomeRock(r as never, { uid, myTeamIds, hasMyOpenMilestone: mine, fullAccess: view === "full" });
    const bucket = rockBucket(r as never);
    const why = !isHomeRockActive(r as never)
      ? `not active (status ${String(r.status)}${r.archived_at ? ", archived" : ""})`
      : mine
        ? "has a milestone assigned to you"
        : r.owner_id === uid
          ? "you own it"
          : bucket !== "owner" && myTeamIds.has(r.team_id)
            ? `${bucket} rock on your team`
            : (r.audience_user_ids as string[] | undefined)?.includes(uid)
              ? "you are in its audience"
              : "a team of yours is in its audience";
    const line = `  ${r.title}  — owner ${await nameFor(r.owner_id)}, ${teamName.get(r.team_id) ?? r.team_id}, type ${String(r.rock_type ?? "—")}: ${why}`;
    if (show) shown.push(`[${SECTION[bucket]}]${line}`);
    else if (r.owner_id === uid) hidden.push(line);
  }
  console.log(`Home shows ${shown.length} rock(s):`);
  shown.sort().forEach((l) => console.log(l));
  console.log(`\nOwned by ${me} but not shown (${hidden.length}):`);
  hidden.forEach((l) => console.log(l));

  // Rocks owned by another user doc with the same name — the import may have
  // matched (or created) a different account than the one signing in.
  const key = normalizePersonKey(me);
  const twins = (await db.collection("users").get()).docs.filter(
    (d) =>
      d.id !== uid &&
      normalizePersonKey(
        (d.data().display_name as string) || [d.data().first_name, d.data().last_name].filter(Boolean).join(" "),
      ) === key,
  );
  for (const t of twins) {
    const owned = await db.collection("rocks").where("owner_id", "==", t.id).get();
    console.log(`\nAnother user doc named ${me}: ${t.id} (${String(t.data().email ?? "no email")}) owns ${owned.size} rock(s).`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
