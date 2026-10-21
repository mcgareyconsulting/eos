// P14 emulator spike — see spikes/README.md and docs/spikes/P14-rules-hasany.md.
//
// Needs a running Firestore emulator (FIRESTORE_EMULATOR_HOST), so it is NOT
// in the default `pnpm test` glob. Run with `pnpm spike:p14`.

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  type Firestore,
  type Query,
  updateDoc,
} from "firebase/firestore";

const T = "team-T";
// 20 teams with T at index 15 — past the current 8-entry unroll in
// listSharedToMe, which could never authorize this doc for alice.
const MANY = Array.from({ length: 20 }, (_, i) => (i === 15 ? T : `team-${i}`));

// emulators:exec runs the command from the repo root (where pnpm was invoked).
const RULES_PATH = [resolve("spikes/p14-hasany.rules"), resolve("p14-hasany.rules")].find(existsSync)!;

let env: RulesTestEnvironment;

before(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(host, "FIRESTORE_EMULATOR_HOST unset — run via `pnpm spike:p14`");
  const [hostname, port] = host.split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-p14-hasany",
    firestore: {
      host: hostname,
      port: Number(port),
      rules: readFileSync(RULES_PATH, "utf8"),
    },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice"), { team_ids: [T, "team-X"] });
    await setDoc(doc(db, "users/bob"), { team_ids: ["team-Z"] });
    await setDoc(doc(db, "users/carol"), { display_name: "Carol" }); // no team_ids
    // dave has no profile at all.
    for (const col of ["rocks", "rocks_safe"]) {
      await setDoc(doc(db, `${col}/shared`), { team_id: "team-A", shared_team_ids: [T, "team-B"] });
      await setDoc(doc(db, `${col}/owned`), { team_id: T, shared_team_ids: [] });
      await setDoc(doc(db, `${col}/many`), { team_id: "team-OTHER", shared_team_ids: MANY });
      // No shared_team_ids at all — most real rocks look like this.
      await setDoc(doc(db, `${col}/bare`), { team_id: T });
      await setDoc(doc(db, `${col}/elsewhere`), { team_id: "team-Q", shared_team_ids: ["team-Q2"] });
    }
  });
});

// rules-unit-testing hands back the compat Firestore; the modular functions
// accept it at runtime (the documented pattern), the types just don't agree.
const as = (uid: string): Firestore =>
  env.authenticatedContext(uid).firestore() as unknown as Firestore;

/** onSnapshot as a promise: resolves on the first snapshot, rejects on a listen error. */
function listenOnce(q: Query): Promise<number> {
  return new Promise((ok, fail) => {
    const unsub = onSnapshot(
      q,
      (snap) => {
        unsub();
        ok(snap.size);
      },
      (err) => fail(err),
    );
  });
}

for (const col of ["rocks", "rocks_safe"] as const) {
  describe(`${col}: where(shared_team_ids array-contains T)`, () => {
    const q = (db: Firestore) => query(collection(db, col), where("shared_team_ids", "array-contains", T));

    test("ALLOWED for a user whose team_ids contains T (getDocs)", async () => {
      const snap = await assertSucceeds(getDocs(q(as("alice"))));
      assert.deepEqual(snap.docs.map((d) => d.id).sort(), ["many", "shared"]);
    });

    test("ALLOWED for the same user as a live listener (onSnapshot)", async () => {
      assert.equal(await assertSucceeds(listenOnce(q(as("alice")))), 2);
    });

    test("DENIED for a user whose team_ids does not contain T", async () => {
      await assertFails(getDocs(q(as("bob"))));
      await assertFails(listenOnce(q(as("bob"))));
    });
  });

  describe(`${col}: where(team_id == T)`, () => {
    const q = (db: Firestore) => query(collection(db, col), where("team_id", "==", T));

    test("ALLOWED for a user whose team_ids contains T", async () => {
      const snap = await assertSucceeds(getDocs(q(as("alice"))));
      assert.deepEqual(snap.docs.map((d) => d.id).sort(), ["bare", "owned"]);
      assert.equal(await assertSucceeds(listenOnce(q(as("alice")))), 2);
    });

    test("DENIED for a user whose team_ids does not contain T", async () => {
      await assertFails(getDocs(q(as("bob"))));
    });
  });

  describe(`${col}: get() by id`, () => {
    test("shared-in doc: allowed for alice, denied for bob", async () => {
      await assertSucceeds(getDoc(doc(as("alice"), `${col}/shared`)));
      await assertFails(getDoc(doc(as("bob"), `${col}/shared`)));
    });

    test("shared into 20 teams, T at index 15 — past the old 8 cap", async () => {
      await assertSucceeds(getDoc(doc(as("alice"), `${col}/many`)));
      await assertFails(getDoc(doc(as("bob"), `${col}/many`)));
    });

    test("owned doc without shared_team_ids field: allowed for alice", async () => {
      await assertSucceeds(getDoc(doc(as("alice"), `${col}/bare`)));
      await assertFails(getDoc(doc(as("bob"), `${col}/bare`)));
    });

    test("doc on a team alice is not on: denied", async () => {
      await assertFails(getDoc(doc(as("alice"), `${col}/elsewhere`)));
    });
  });

  describe(`${col}: fail-closed edges`, () => {
    test("profile without team_ids: denied", async () => {
      await assertFails(getDoc(doc(as("carol"), `${col}/shared`)));
      await assertFails(getDocs(query(collection(as("carol"), col), where("team_id", "==", T))));
    });

    test("no profile at all: denied", async () => {
      await assertFails(getDoc(doc(as("dave"), `${col}/shared`)));
      await assertFails(
        getDocs(query(collection(as("dave"), col), where("shared_team_ids", "array-contains", T))),
      );
    });

    test("unauthenticated: denied", async () => {
      await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `${col}/shared`)));
    });

    test("unfiltered collection read: denied (rules are not filters)", async () => {
      await assertFails(getDocs(collection(as("alice"), col)));
    });
  });
}

// Observation, not a requirement: a query on a team the caller is NOT on is
// denied even if every matching doc happens to be readable another way. The
// app only ever queries by a team the viewer is on, so this is expected.
describe("observed: array-contains a team the caller is not on", () => {
  test("alice querying team-B (r'shared' is also shared to T) is denied", async () => {
    await assertFails(
      getDocs(query(collection(as("alice"), "rocks_safe"), where("shared_team_ids", "array-contains", "team-B"))),
    );
  });
});

// team_ids grants access, so a user must not be able to write their own.
describe("users/{uid}: the owner cannot self-grant team_ids", () => {
  test("updating other profile fields is allowed", async () => {
    await assertSucceeds(updateDoc(doc(as("alice"), "users/alice"), { display_name: "Alice" }));
  });

  test("adding a team to your own team_ids is denied", async () => {
    await assertFails(updateDoc(doc(as("bob"), "users/bob"), { team_ids: ["team-Z", T] }));
  });

  test("creating your profile with team_ids is denied; without is allowed", async () => {
    await assertFails(setDoc(doc(as("dave"), "users/dave"), { team_ids: [T] }));
    await assertSucceeds(setDoc(doc(as("dave"), "users/dave"), { display_name: "Dave" }));
  });

  test("a merge-set that tries to slip team_ids in is denied", async () => {
    await assertFails(setDoc(doc(as("carol"), "users/carol"), { team_ids: [T] }, { merge: true }));
  });
});
