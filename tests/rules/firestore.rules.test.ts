// Emulator tests for the real firestore.rules. See tests/rules/README.md.
// Needs a running Firestore emulator, so it is NOT in the default `pnpm test`
// glob. Run with `pnpm test:rules`.

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentReference,
  type Firestore,
  type Query,
} from "firebase/firestore";

const T = "team-T";
const WEEK = "2026-01-05";

let env: RulesTestEnvironment;

before(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(host, "FIRESTORE_EMULATOR_HOST unset — run via `pnpm test:rules`");
  const [hostname, port] = host.split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-eos-rules",
    firestore: { host: hostname, port: Number(port), rules: readFileSync(resolve("firestore.rules"), "utf8") },
  });
});

after(async () => {
  await env?.cleanup();
});

// alice: member of T (team_members doc + users.team_ids).
// bob: member of an unrelated team only. kim: on team-11 only (shared lists).
const SHARED_12 = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (path: string, data: object) => setDoc(doc(db, path), data);
    await put("users/alice", { team_ids: [T, "team-X"] });
    await put("users/bob", { team_ids: ["team-Z"] });
    await put("users/kim", { team_ids: ["team-11"] });
    await put(`team_members/${T}__alice`, { team_id: T, user_id: "alice", role: "member" });
    await put("team_members/team-Z__bob", { team_id: "team-Z", user_id: "bob", role: "member" });
    await put("team_members/team-11__kim", { team_id: "team-11", user_id: "kim", role: "member" });

    await put("meetings/m1", { team_id: T });
    await put("meetings/m1/effectiveness_scores/alice", { team_id: T, score: 5 });
    await put("meetings/m1/presence/alice", { at: 1 });
    await put("headlines/h1", { team_id: T });
    await put("agendas/a1", { team_id: T });

    await put("scorecard_metrics/mt-own", { team_id: T, shared_team_ids: [] });
    await put("scorecard_metrics/mt-shared", { team_id: "team-A", shared_team_ids: [T, "team-B"] });
    await put("scorecard_metrics/mt-12", { team_id: "team-A", shared_team_ids: SHARED_12 });
    await put("scorecard_groups/g1", { team_id: T });
    await put(`scorecard_entries/mt-own__${WEEK}`, { metric_id: "mt-own", week_start_date: WEEK });
    await put(`scorecard_entries/mt-shared__${WEEK}`, { metric_id: "mt-shared", week_start_date: WEEK });
    await put(`scorecard_entries/mt-12__${WEEK}`, { metric_id: "mt-12", week_start_date: WEEK });

    await put("rocks/r-own", { team_id: T, owner_id: "carl", shared_team_ids: [] });
    await put("rocks/r-shared", { team_id: "team-A", owner_id: "carl", shared_team_ids: [T] });
    await put("rocks/r-12", { team_id: "team-A", owner_id: "carl", shared_team_ids: SHARED_12 });
    await put("rock_status_updates/s1", { team_id: T, rock_id: "r-own", user_id: "carl" });
    await put("entity_comments/c-rock", { team_id: T, entity_type: "rock", entity_id: "r-own" });
    await put("entity_comments/c-issue", { team_id: T, entity_type: "issue", entity_id: "i1" });

    await put("todos/t-team", { team_id: T, visibility: "team", owner_id: "carl" });
    await put("todos/t-priv", { team_id: T, visibility: "private", owner_id: "alice" });
    await put("todos/t-cross", { team_id: "team-Q", visibility: "team", owner_id: "alice" });
    await put("issues/i1", { team_id: T });
    await put("issue_votes/v1", { team_id: T, user_id: "alice", issue_id: "i1" });
    await put("notifications/n1", { user_id: "alice", read_at: null, created_at: 2 });
    await put("notifications/n2", { user_id: "alice", read_at: 1, created_at: 1 });
    await put("entity_activity/ea-team", {
      team_id: T,
      entity_type: "todo",
      entity_id: "t-team",
      visibility: "team",
      owner_id: "carl",
    });
    await put("entity_activity/ea-priv", {
      team_id: T,
      entity_type: "todo",
      entity_id: "t-priv",
      visibility: "private",
      owner_id: "alice",
    });

    await put("organizations/o1", { name: "HPB" });
    await put("teams/team-T", { name: "T" });
    await put("audit_log/e1", { x: 1 });
    await put("google_tasks_connections/alice", { refresh_token: "secret" });
    await put("oauth_csrf_states/s", { uid: "alice" });
  });
});

const as = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const anon = (): Firestore => env.unauthenticatedContext().firestore() as unknown as Firestore;
const asAdmin = (): Firestore =>
  env
    .authenticatedContext("root", { role: "admin", email: "root@highplainsbank.com", email_verified: true })
    .firestore() as unknown as Firestore;

type Target = Query | DocumentReference;
const run = (t: Target): Promise<unknown> => (t.type === "document" ? getDoc(t as DocumentReference) : getDocs(t as Query));

interface ReadCase {
  name: string;
  q: (db: Firestore) => Target;
}

const teamQ = (col: string) => (db: Firestore) => query(collection(db, col), where("team_id", "==", T));

// Mirrors the client listeners (alice is the member; queries that name a uid
// name alice, so bob querying them is a different user's data).
const READS: ReadCase[] = [
  { name: "meetings where team_id==T", q: teamQ("meetings") },
  { name: "meetings/{id}", q: (db) => doc(db, "meetings/m1") },
  { name: "meetings/{id}/effectiveness_scores", q: (db) => collection(db, "meetings/m1/effectiveness_scores") },
  { name: "headlines where team_id==T", q: teamQ("headlines") },
  { name: "scorecard_metrics where team_id==T", q: teamQ("scorecard_metrics") },
  {
    name: "scorecard_metrics where shared_team_ids array-contains T",
    q: (db) => query(collection(db, "scorecard_metrics"), where("shared_team_ids", "array-contains", T)),
  },
  { name: "scorecard_groups where team_id==T", q: teamQ("scorecard_groups") },
  {
    name: "scorecard_entries metric_id in [...] and week_start_date >= d",
    q: (db) =>
      query(
        collection(db, "scorecard_entries"),
        where("metric_id", "in", ["mt-own", "mt-shared"]),
        where("week_start_date", ">=", "2026-01-01"),
      ),
  },
  { name: "rocks where team_id==T", q: teamQ("rocks") },
  {
    name: "rocks where shared_team_ids array-contains T",
    q: (db) => query(collection(db, "rocks"), where("shared_team_ids", "array-contains", T)),
  },
  {
    name: "todos team-visible",
    q: (db) => query(collection(db, "todos"), where("team_id", "==", T), where("visibility", "==", "team")),
  },
  {
    name: "todos private, owner_id==uid",
    q: (db) =>
      query(
        collection(db, "todos"),
        where("team_id", "==", T),
        where("visibility", "==", "private"),
        where("owner_id", "==", "alice"),
      ),
  },
  { name: "todos owner_id==uid (cross-team)", q: (db) => query(collection(db, "todos"), where("owner_id", "==", "alice")) },
  { name: "todos/{id}", q: (db) => doc(db, "todos/t-team") },
  { name: "rock_status_updates where team_id==T", q: teamQ("rock_status_updates") },
  { name: "issues where team_id==T", q: teamQ("issues") },
  {
    name: "issue_votes where user_id==uid and team_id==T",
    q: (db) => query(collection(db, "issue_votes"), where("user_id", "==", "alice"), where("team_id", "==", T)),
  },
  {
    name: "entity_comments rock thread (entity_type+entity_id only)",
    q: (db) =>
      query(collection(db, "entity_comments"), where("entity_type", "==", "rock"), where("entity_id", "==", "r-own")),
  },
  {
    name: "entity_comments team-scoped",
    q: (db) =>
      query(
        collection(db, "entity_comments"),
        where("team_id", "==", T),
        where("entity_type", "==", "issue"),
        where("entity_id", "==", "i1"),
      ),
  },
  {
    name: "entity_activity team-visible",
    q: (db) =>
      query(
        collection(db, "entity_activity"),
        where("team_id", "==", T),
        where("entity_type", "==", "todo"),
        where("entity_id", "==", "t-team"),
        where("visibility", "==", "team"),
      ),
  },
  {
    name: "entity_activity private (+owner_id)",
    q: (db) =>
      query(
        collection(db, "entity_activity"),
        where("team_id", "==", T),
        where("entity_type", "==", "todo"),
        where("entity_id", "==", "t-priv"),
        where("visibility", "==", "private"),
        where("owner_id", "==", "alice"),
      ),
  },
];

describe("client reads: member allowed, non-member denied", () => {
  for (const c of READS) {
    test(c.name, async () => {
      await assertSucceeds(run(c.q(as("alice"))));
      await assertFails(run(c.q(as("bob"))));
      await assertFails(run(c.q(anon())));
    });
  }
});

describe("shared lists: no 8-share cap (hasAny on users.team_ids)", () => {
  // team-11 is the 11th entry of a 12-team share list; kim is on team-11 only.
  test("rock shared to 12 teams: readable by a member of team #11 (doc + list)", async () => {
    await assertSucceeds(getDoc(doc(as("kim"), "rocks/r-12")));
    const snap = await assertSucceeds(
      getDocs(query(collection(as("kim"), "rocks"), where("shared_team_ids", "array-contains", "team-11"))),
    );
    assert.deepEqual(
      snap.docs.map((d) => d.id),
      ["r-12"],
    );
    await assertFails(getDoc(doc(as("bob"), "rocks/r-12")));
  });

  test("scorecard metric shared to 12 teams: readable by a member of team #11 (doc + list + entries)", async () => {
    await assertSucceeds(getDoc(doc(as("kim"), "scorecard_metrics/mt-12")));
    await assertSucceeds(
      getDocs(query(collection(as("kim"), "scorecard_metrics"), where("shared_team_ids", "array-contains", "team-11"))),
    );
    await assertSucceeds(getDocs(query(collection(as("kim"), "scorecard_entries"), where("metric_id", "in", ["mt-12"]))));
    await assertFails(getDoc(doc(as("bob"), "scorecard_metrics/mt-12")));
  });

  test("user with no profile / no team_ids is denied", async () => {
    await assertFails(getDoc(doc(as("nobody"), "rocks/r-shared")));
  });
});

describe("notifications: readable only by their user_id", () => {
  const list = (db: Firestore) =>
    query(collection(db, "notifications"), where("user_id", "==", "alice"), orderBy("created_at", "desc"), limit(20));
  const unread = (db: Firestore) =>
    query(collection(db, "notifications"), where("user_id", "==", "alice"), where("read_at", "==", null));

  test("owner can list and read unread", async () => {
    assert.equal((await assertSucceeds(getDocs(list(as("alice"))))).size, 2);
    assert.equal((await assertSucceeds(getDocs(unread(as("alice"))))).size, 1);
    await assertSucceeds(getDoc(doc(as("alice"), "notifications/n1")));
  });

  test("another user, an admin claim, and anonymous are denied", async () => {
    await assertFails(getDocs(list(as("bob"))));
    await assertFails(getDocs(unread(as("bob"))));
    await assertFails(getDoc(doc(as("bob"), "notifications/n1")));
    await assertFails(getDoc(doc(asAdmin(), "notifications/n1")));
    await assertFails(getDocs(list(anon())));
  });
});

describe("no client writes, on any collection, for anyone", () => {
  const PATHS = [
    "organizations/o1",
    "users/alice",
    "teams/team-T",
    `team_members/${T}__alice`,
    "scorecard_metrics/mt-own",
    "scorecard_groups/g1",
    `scorecard_entries/mt-own__${WEEK}`,
    "rocks/r-own",
    "rock_status_updates/s1",
    "todos/t-team",
    "todos/t-priv",
    "issues/i1",
    "issue_votes/v1",
    "entity_comments/c-rock",
    "notifications/n1",
    "headlines/h1",
    "agendas/a1",
    "meetings/m1",
    "meetings/m1/effectiveness_scores/alice",
    "meetings/m1/presence/alice",
    "entity_activity/ea-team",
    "audit_log/e1",
    "google_tasks_connections/alice",
    "oauth_csrf_states/s",
  ];
  const actors: Array<() => Firestore> = [() => as("alice"), asAdmin, anon];

  for (const path of PATHS) {
    test(`${path}: set / update / delete / create all rejected`, async () => {
      for (const actor of actors) {
        const db = actor();
        await assertFails(setDoc(doc(db, path), { team_id: T, user_id: "alice", hacked: true }));
        await assertFails(updateDoc(doc(db, path), { hacked: true }));
        await assertFails(deleteDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, `${path}-new`), { team_id: T, user_id: "alice" }));
      }
    });
  }

  test("a user cannot write their own team_ids", async () => {
    await assertFails(updateDoc(doc(as("bob"), "users/bob"), { team_ids: ["team-Z", T] }));
    await assertFails(setDoc(doc(as("dave"), "users/dave"), { team_ids: [T] }));
  });
});
