// Parity suite: the client read rules (firestore.rules) against the server
// access modules (lib/access/**), on the same fixtures.
//
// 1. Document matrix — for every fixture document and every viewer, a
//    single-document read is allowed exactly when the module says the viewer
//    can see the item.
// 2. Live query shapes — every listener the app runs (grep onSnapshot /
//    useCollection / useDoc), run by every viewer for every team they could
//    open it from: it must be ALLOWED (a refused listener freezes the live
//    UI) and return exactly the matching documents the module lets them see.
// 3. Hand-rolled queries the UI never makes but a client could: refused.
//
// Needs the Firestore emulator: run with `pnpm test:rules`.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
  type Firestore,
  type Query,
  type QueryConstraint,
} from "firebase/firestore";
import {
  accessFor,
  headlineAccess,
  issueAccess,
  metricAccess,
  milestoneAccess,
  passesTeamGate,
  rockAccess,
  rockSubjectOf,
  todoAccess,
  viewerOf,
  type MetricSubject,
  type TodoSubject,
  type Viewer,
} from "@/lib/access";
import { itemTypeOfTodoDoc } from "@/lib/item-registry";
import { chunkForInQuery, RULES_GET_IN_LIMIT } from "@/lib/firestore-in";

// ---------- teams and viewers ----------

const P = "team-p"; // the items' parent team
const S = "team-s"; // audience team / tracking team
const O = "team-o"; // the off-team assignee's (and creator's) team
const X = "team-x"; // unrelated team

type Who = {
  viewer: Viewer;
  /** Teams this viewer can open a team page from (admin: any). */
  pageTeams: string[];
};

function who(uid: string, teams: string[], opts: { admin?: boolean; leaderOf?: string[] } = {}): Who {
  const viewer = viewerOf(uid, opts.admin ?? false, teams, opts.leaderOf ?? []);
  return { viewer, pageTeams: opts.admin ? [P, S, O, X] : teams };
}

const W = {
  admin: who("u-admin", [], { admin: true }),
  parentLeader: who("u-lead", [P], { leaderOf: [P] }),
  parentMember: who("u-mem", [P]),
  audienceTeam: who("u-shr", [S]),
  audiencePerson: who("u-aud", [X]),
  offTeamAssignee: who("u-asg", [O]),
  privateCreator: who("u-crt", [O]),
  outsider: who("u-out", [X]),
} satisfies Record<string, Who>;
const WHO = Object.entries(W) as [keyof typeof W, Who][];

// ---------- fixtures ----------

type Data = Record<string, unknown>;
const F: Record<string, Data> = {};
const put = (path: string, data: Data) => {
  F[path] = data;
};

// Rocks: every shape lib/access/rock.ts reads.
const ROCKS: Record<string, Data> = {
  "r-aud": { team_id: P, owner_id: "u-mem", audience_team_ids: [S], audience_user_ids: ["u-aud"], private: false },
  "r-priv": { team_id: P, owner_id: "u-lead", audience_team_ids: [], audience_user_ids: [], private: true },
  "r-none": { team_id: P, owner_id: "u-mem", audience_team_ids: [], audience_user_ids: [], private: false },
  // Legacy names until P13: shared_team_ids (= audience teams), team_only (= private).
  "r-legacy": { team_id: P, owner_id: "u-mem", shared_team_ids: [S], team_only: false },
  "r-legacy-only": { team_id: P, owner_id: "u-mem", shared_team_ids: [], team_only: true },
  // Legacy rock that granted nothing new: milestone_owner_ids is not a grant.
  "r-mo": { team_id: P, owner_id: "u-mem", private: false, audience_team_ids: [], audience_user_ids: [], milestone_owner_ids: ["u-asg"] },
};
for (const [id, d] of Object.entries(ROCKS)) put(`rocks/${id}`, d);

const todo = (d: Data): Data => ({ team_id: P, source_rock_id: null, created_by: "u-mem", ...d });
const TODOS: Record<string, Data> = {
  "t-team": todo({ visibility: "team", owner_id: "u-mem" }),
  "t-team-asg": todo({ visibility: "team", owner_id: "u-asg" }),
  "t-priv-mem": todo({ visibility: "private", owner_id: "u-mem" }),
  "t-priv-crt": todo({ visibility: "private", owner_id: "u-asg", created_by: "u-crt" }),
  "t-priv-lead": todo({ visibility: "private", owner_id: "u-lead", created_by: "u-lead" }),
};
for (const rockId of Object.keys(ROCKS)) {
  TODOS[`m-${rockId}`] = todo({ visibility: "team", owner_id: "u-asg", source_rock_id: rockId });
}
// A legacy private milestone (updateTodoMeta can still set it): milestone
// access (rock + assignee), not the private to-do rule — its creator alone
// does not see it.
TODOS["m-priv-legacy"] = todo({ visibility: "private", owner_id: "u-asg", created_by: "u-crt", source_rock_id: "r-none" });
for (const [id, d] of Object.entries(TODOS)) put(`todos/${id}`, d);

put("issues/i-1", { team_id: P, owner_id: "u-mem" });
put("headlines/h-1", { team_id: P, created_by: "u-mem" });
put("issue_votes/v-1", { team_id: P, user_id: "u-mem", issue_id: "i-1" });
put("scorecard_groups/g-1", { team_id: P, name: "Sales" });
put("agendas/a-1", { team_id: P });
put("meetings/mtg-1", { team_id: P });
put("meetings/mtg-1/effectiveness_scores/u-mem", { score: 8 });
put("meetings/mtg-1/presence/u-mem", { at: 1 });

const WEEK = "2026-01-05";
const METRICS: Record<string, Data> = {
  "mt-home": { team_id: P, is_public: false, shared_team_ids: [] },
  "mt-public": { team_id: P, is_public: true, shared_team_ids: [] },
  "mt-tracked": { team_id: P, is_public: true, shared_team_ids: [S] },
  // Legacy share of a private metric (before P7a's is_public backfill).
  "mt-legacy": { team_id: P, is_public: false, shared_team_ids: [S] },
  "mt-s": { team_id: S, shared_team_ids: [] },
};
for (const [id, d] of Object.entries(METRICS)) {
  put(`scorecard_metrics/${id}`, d);
  put(`scorecard_entries/${id}__${WEEK}`, { metric_id: id, week_start_date: WEEK, value: 1 });
}

// rock_status_updates are always filed under the parent team (setRockStatus).
for (const id of Object.keys(ROCKS)) put(`rock_status_updates/su-${id}`, { team_id: P, rock_id: id, status: "on_track" });

// Threads: one comment per item, filed under the item's team.
for (const id of Object.keys(ROCKS)) put(`entity_comments/c-${id}`, { team_id: P, entity_type: "rock", entity_id: id });
for (const id of Object.keys(TODOS)) put(`entity_comments/c-${id}`, { team_id: P, entity_type: "todo", entity_id: id });
put("entity_comments/c-i-1", { team_id: P, entity_type: "issue", entity_id: "i-1" });
put("entity_comments/c-h-1", { team_id: P, entity_type: "headline", entity_id: "h-1" });

// Activity rows carry a snapshot of visibility/owner that grants nothing.
for (const [id, d] of Object.entries(TODOS)) {
  put(`entity_activity/a-${id}`, {
    team_id: P,
    entity_type: "todo",
    entity_id: id,
    visibility: d.visibility,
    owner_id: d.owner_id,
  });
}

put("notifications/n-mem", { user_id: "u-mem", read_at: null, created_at: 2 });
put("notifications/n-asg", { user_id: "u-asg", read_at: null, created_at: 1 });

put("organizations/o-1", { name: "HPB" });
put(`teams/${P}`, { name: "P" });
put(`team_members/${P}__u-mem`, { team_id: P, user_id: "u-mem", role: "member" });
put("audit_log/e-1", { x: 1 });
// users/{uid}.team_ids is what myTeamIds() reads (server-maintained).
for (const [, w] of WHO) put(`users/${w.viewer.uid}`, { team_ids: [...w.viewer.teamIds] });

// ---------- the module's answer for a document ----------

function rockOf(id: unknown) {
  return rockSubjectOf(typeof id === "string" ? ROCKS[id] : undefined);
}

function todoSees(d: Data, v: Viewer): boolean {
  if (itemTypeOfTodoDoc(d as { source_rock_id?: string | null }) === "milestone") {
    return milestoneAccess.canSee(
      { milestone: d as never, rock: rockOf(d.source_rock_id) },
      v,
    );
  }
  return todoAccess.canSee(d as TodoSubject, v);
}

/** The thread read gate (lib/firebase/thread-gate.ts → canComment). */
function threadSees(d: Data, v: Viewer): boolean {
  const id = String(d.entity_id);
  switch (d.entity_type) {
    case "rock":
      return accessFor("rock").canComment(rockOf(id), v);
    case "todo": {
      const t = TODOS[id];
      if (itemTypeOfTodoDoc(t as { source_rock_id?: string | null }) === "milestone") {
        return accessFor("milestone").canComment({ milestone: t as never, rock: rockOf(t.source_rock_id) }, v);
      }
      return accessFor("todo").canComment(t as TodoSubject, v);
    }
    case "issue":
      return accessFor("issue").canComment(F[`issues/${id}`] as never, v);
    case "headline":
      return accessFor("headline").canComment(F[`headlines/${id}`] as never, v);
    default:
      return false;
  }
}

function moduleSees(path: string, v: Viewer): boolean {
  const d = F[path];
  const [col, id] = path.split("/");
  switch (col) {
    case "rocks":
      return rockAccess.canSee(rockSubjectOf(d), v);
    case "todos":
      return todoSees(d, v);
    case "rock_status_updates":
      return rockAccess.canSee(rockOf(d.rock_id), v);
    case "entity_comments":
      return threadSees(d, v);
    case "entity_activity":
      return todoSees(TODOS[String(d.entity_id)], v);
    case "scorecard_metrics":
      return metricAccess.canSee(d as MetricSubject, v);
    case "scorecard_entries":
      return metricAccess.canSee(METRICS[String(d.metric_id)] as MetricSubject, v);
    case "issues":
    case "issue_votes":
      return issueAccess.canSee(F[col === "issues" ? path : `issues/${d.issue_id}`] as never, v);
    case "headlines":
      return headlineAccess.canSee(d as never, v);
    case "scorecard_groups":
    case "agendas":
      return passesTeamGate(v, String(d.team_id));
    case "meetings":
      return passesTeamGate(v, String(F[`meetings/${id}`].team_id));
    case "notifications":
      return d.user_id === v.uid;
    case "audit_log":
      return v.isAdmin;
    // The directory has no client reader: server pages only.
    case "users":
    case "teams":
    case "team_members":
    case "organizations":
      return false;
    default:
      throw new Error(`no module answer for ${path}`);
  }
}

// ---------- emulator ----------

let env: RulesTestEnvironment;

before(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(host, "FIRESTORE_EMULATOR_HOST unset — run via `pnpm test:rules`");
  const [hostname, port] = host.split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-eos-rules-parity",
    firestore: { host: hostname, port: Number(port), rules: readFileSync(resolve("firestore.rules"), "utf8") },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await Promise.all(Object.entries(F).map(([path, data]) => setDoc(doc(db, path), data)));
  });
});

after(async () => {
  await env?.cleanup();
});

function dbFor(w: Who): Firestore {
  const claims = w.viewer.isAdmin ? { role: "admin" } : {};
  return env.authenticatedContext(w.viewer.uid, claims).firestore() as unknown as Firestore;
}

async function allowed(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === "permission-denied") return false;
    throw e;
  }
}

// ---------- 1. document matrix ----------

describe("parity: single-document reads = lib/access canSee", () => {
  const byCollection = new Map<string, string[]>();
  for (const path of Object.keys(F)) {
    const col = path.split("/")[0];
    byCollection.set(col, [...(byCollection.get(col) ?? []), path]);
  }
  for (const [col, paths] of byCollection) {
    test(col, async () => {
      const mismatches: string[] = [];
      for (const [name, w] of WHO) {
        const db = dbFor(w);
        for (const path of paths) {
          const want = moduleSees(path, w.viewer);
          const got = await allowed(getDoc(doc(db, path)));
          if (want !== got) mismatches.push(`${name} ${path}: module=${want} rules=${got}`);
        }
      }
      assert.deepEqual(mismatches, []);
    });
  }

  test("the matrix is not vacuous: every viewer sees something and misses something", () => {
    for (const [name, w] of WHO) {
      const seen = Object.keys(F).filter((p) => moduleSees(p, w.viewer)).length;
      assert.ok(seen > 0, `${name} sees nothing`);
      assert.ok(seen < Object.keys(F).length, `${name} sees everything`);
    }
  });
});

// ---------- 2. live query shapes ----------

type Shape = {
  name: string;
  /** Where the app runs it. */
  from: string;
  /** Build the query for a viewer on a page team (null = not run there). */
  q: (db: Firestore, ctx: { team: string; me: string }) => Query | null;
  /** The fixture paths the query's filters match (before access). */
  matches: (ctx: { team: string; me: string }) => string[];
};

const paths = (col: string, pred: (d: Data) => boolean) =>
  Object.keys(F).filter((p) => p.split("/").length === 2 && p.startsWith(`${col}/`) && pred(F[p]));
const eqQ = (col: string, ...c: QueryConstraint[]) => (db: Firestore) => query(collection(db, col), ...c);

const onScorecard = (team: string) =>
  Object.keys(METRICS).filter((id) => {
    const m = METRICS[id];
    return m.team_id === team || (m.shared_team_ids as string[] | undefined)?.includes(team);
  });

const SHAPES: Shape[] = [
  {
    name: "meetings team_id==T",
    from: "meetings-list.tsx",
    q: (db, { team }) => eqQ("meetings", where("team_id", "==", team))(db),
    matches: ({ team }) => paths("meetings", (d) => d.team_id === team),
  },
  {
    name: "headlines team_id==T",
    from: "segment-headlines.tsx",
    q: (db, { team }) => eqQ("headlines", where("team_id", "==", team))(db),
    matches: ({ team }) => paths("headlines", (d) => d.team_id === team),
  },
  {
    name: "scorecard_metrics team_id==T",
    from: "segment-scorecard.tsx",
    q: (db, { team }) => eqQ("scorecard_metrics", where("team_id", "==", team))(db),
    matches: ({ team }) => paths("scorecard_metrics", (d) => d.team_id === team),
  },
  {
    name: "scorecard_metrics shared_team_ids array-contains T",
    from: "segment-scorecard.tsx",
    q: (db, { team }) => eqQ("scorecard_metrics", where("shared_team_ids", "array-contains", team))(db),
    matches: ({ team }) => paths("scorecard_metrics", (d) => ((d.shared_team_ids as string[]) ?? []).includes(team)),
  },
  {
    name: "scorecard_groups team_id==T",
    from: "segment-scorecard.tsx",
    q: (db, { team }) => eqQ("scorecard_groups", where("team_id", "==", team))(db),
    matches: ({ team }) => paths("scorecard_groups", (d) => d.team_id === team),
  },
  {
    name: "scorecard_entries metric_id in [T's scorecard] and week_start_date >= d",
    from: "use-scorecard-entries.ts",
    q: (db, { team }) => {
      const ids = onScorecard(team);
      if (ids.length === 0) return null;
      assert.ok(ids.length <= RULES_GET_IN_LIMIT);
      return query(
        collection(db, "scorecard_entries"),
        where("metric_id", "in", ids),
        where("week_start_date", ">=", "2026-01-01"),
      );
    },
    matches: ({ team }) => paths("scorecard_entries", (d) => onScorecard(team).includes(String(d.metric_id))),
  },
  {
    name: "rocks team_id==T",
    from: "segment-rocks.tsx, segment-todos.tsx, todos-board.tsx",
    q: (db, { team }) => eqQ("rocks", where("team_id", "==", team))(db),
    matches: ({ team }) => paths("rocks", (d) => d.team_id === team),
  },
  {
    name: "rocks audience_team_ids array-contains T",
    from: "segment-rocks.tsx",
    q: (db, { team }) => eqQ("rocks", where("audience_team_ids", "array-contains", team))(db),
    matches: ({ team }) => paths("rocks", (d) => ((d.audience_team_ids as string[]) ?? []).includes(team)),
  },
  {
    name: "rocks shared_team_ids array-contains T (legacy, until P13)",
    from: "segment-rocks.tsx",
    q: (db, { team }) => eqQ("rocks", where("shared_team_ids", "array-contains", team))(db),
    matches: ({ team }) => paths("rocks", (d) => ((d.shared_team_ids as string[]) ?? []).includes(team)),
  },
  {
    name: "todos team_id==T and visibility==team",
    from: "segment-rocks.tsx, segment-todos.tsx, todos-board.tsx",
    q: (db, { team }) => eqQ("todos", where("team_id", "==", team), where("visibility", "==", "team"))(db),
    matches: ({ team }) => paths("todos", (d) => d.team_id === team && d.visibility === "team"),
  },
  {
    name: "todos team_id==T and visibility==private and owner_id==me",
    from: "segment-todos.tsx, todos-board.tsx",
    q: (db, { team, me }) =>
      eqQ("todos", where("team_id", "==", team), where("visibility", "==", "private"), where("owner_id", "==", me))(db),
    matches: ({ team, me }) =>
      paths("todos", (d) => d.team_id === team && d.visibility === "private" && d.owner_id === me),
  },
  {
    name: "todos team_id==T and visibility==private and created_by==me",
    from: "todos-board.tsx",
    q: (db, { team, me }) =>
      eqQ("todos", where("team_id", "==", team), where("visibility", "==", "private"), where("created_by", "==", me))(db),
    matches: ({ team, me }) =>
      paths("todos", (d) => d.team_id === team && d.visibility === "private" && d.created_by === me),
  },
  {
    name: "todos owner_id==me",
    from: "todos-board.tsx",
    q: (db, { me }) => eqQ("todos", where("owner_id", "==", me))(db),
    matches: ({ me }) => paths("todos", (d) => d.owner_id === me),
  },
  {
    name: "rock_status_updates team_id==T",
    from: "segment-rocks.tsx",
    q: (db, { team }) => eqQ("rock_status_updates", where("team_id", "==", team))(db),
    matches: ({ team }) => paths("rock_status_updates", (d) => d.team_id === team),
  },
  {
    name: "issues team_id==T",
    from: "issues-list.tsx, segment-issues.tsx",
    q: (db, { team }) => eqQ("issues", where("team_id", "==", team))(db),
    matches: ({ team }) => paths("issues", (d) => d.team_id === team),
  },
  {
    name: "issue_votes user_id==me and team_id==T",
    from: "segment-issues.tsx",
    q: (db, { team, me }) => eqQ("issue_votes", where("user_id", "==", me), where("team_id", "==", team))(db),
    matches: ({ team, me }) => paths("issue_votes", (d) => d.team_id === team && d.user_id === me),
  },
  {
    name: "notifications user_id==me orderBy created_at desc limit 50",
    from: "notifications-hub.tsx",
    q: (db, { me }) => eqQ("notifications", where("user_id", "==", me), orderBy("created_at", "desc"), limit(50))(db),
    matches: ({ me }) => paths("notifications", (d) => d.user_id === me),
  },
  {
    name: "notifications user_id==me and read_at==null",
    from: "notifications-nav-link.tsx",
    q: (db, { me }) => eqQ("notifications", where("user_id", "==", me), where("read_at", "==", null))(db),
    matches: ({ me }) => paths("notifications", (d) => d.user_id === me),
  },
  {
    name: "meetings/{id}/effectiveness_scores",
    from: "conclude-review.tsx",
    q: (db, { team }) => (team === P ? collection(db, "meetings/mtg-1/effectiveness_scores") : null),
    matches: () => ["meetings/mtg-1/effectiveness_scores/u-mem"],
  },
];

const ids = (paths: string[]) => paths.map((p) => p.split("/").pop()!).sort();

describe("live query shapes: allowed from every page they run on, returning exactly what the module allows", () => {
  for (const shape of SHAPES) {
    test(`${shape.name}  (${shape.from})`, async () => {
      const problems: string[] = [];
      for (const [name, w] of WHO) {
        for (const team of w.pageTeams) {
          const ctx = { team, me: w.viewer.uid };
          const q = shape.q(dbFor(w), ctx);
          if (!q) continue;
          const want = ids(
            shape.matches(ctx).filter((p) =>
              p.startsWith("meetings/mtg-1/") ? passesTeamGate(w.viewer, P) : moduleSees(p, w.viewer),
            ),
          );
          try {
            const snap = await getDocs(q);
            const got = snap.docs.map((d) => d.id).sort();
            if (JSON.stringify(got) !== JSON.stringify(want)) {
              problems.push(`${name}@${team}: got [${got}] want [${want}]`);
            }
          } catch (e) {
            problems.push(`${name}@${team}: REFUSED (${(e as { code?: string }).code})`);
          }
        }
      }
      assert.deepEqual(problems, []);
    });
  }
});

// Threads and the activity trace are queried by entity alone (to-do, rock) or
// by team + entity (issue, headline). The rule gets the parent: the listener
// is allowed exactly when the module lets the viewer read the thread.
describe("live query shapes: item threads and the to-do activity trace", () => {
  const threadQuery = (db: Firestore, type: string, id: string, team: string) =>
    type === "rock" || type === "todo"
      ? query(collection(db, "entity_comments"), where("entity_type", "==", type), where("entity_id", "==", id))
      : query(
          collection(db, "entity_comments"),
          where("team_id", "==", team),
          where("entity_type", "==", type),
          where("entity_id", "==", id),
        );

  const threads = Object.keys(F)
    .filter((p) => p.startsWith("entity_comments/"))
    .map((p) => ({ path: p, type: String(F[p].entity_type), id: String(F[p].entity_id) }));

  test("entity_comments (entity-comments.tsx): every thread × every viewer", async () => {
    const problems: string[] = [];
    for (const [name, w] of WHO) {
      for (const t of threads) {
        const want = threadSees(F[t.path], w.viewer);
        // Issue / headline threads are opened from the item's team page.
        const team = P;
        try {
          const snap = await getDocs(threadQuery(dbFor(w), t.type, t.id, team));
          const got = snap.docs.map((d) => d.id);
          if (!want) problems.push(`${name} ${t.type}/${t.id}: allowed, module says no`);
          else if (got.length !== 1) problems.push(`${name} ${t.type}/${t.id}: got ${got.length} rows`);
        } catch {
          if (want) problems.push(`${name} ${t.type}/${t.id}: REFUSED, module says yes`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  test("entity_activity entity_type==todo and entity_id==X (entity-activity.tsx): every to-do × every viewer", async () => {
    const problems: string[] = [];
    for (const [name, w] of WHO) {
      for (const [id, d] of Object.entries(TODOS)) {
        const want = todoSees(d, w.viewer);
        const q = query(
          collection(dbFor(w), "entity_activity"),
          where("entity_type", "==", "todo"),
          where("entity_id", "==", id),
        );
        const got = await allowed(getDocs(q));
        if (want !== got) problems.push(`${name} ${id}: module=${want} rules=${got}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test("the cases the old rules got wrong", async () => {
    const t = (w: Who, type: string, id: string) => allowed(getDocs(threadQuery(dbFor(w), type, id, P)));
    // Off-team assignee reads the thread of the to-do assigned to them (D1).
    assert.equal(await t(W.offTeamAssignee, "todo", "t-team-asg"), true);
    // A private to-do's creator from another team reads its thread.
    assert.equal(await t(W.privateCreator, "todo", "t-priv-crt"), true);
    // Audit leak closed: parent leader / member cannot read a private thread.
    assert.equal(await t(W.parentLeader, "todo", "t-priv-crt"), false);
    assert.equal(await t(W.parentMember, "todo", "t-priv-lead"), false);
    // Audience person and audience team read the rock thread and status history.
    assert.equal(await t(W.audiencePerson, "rock", "r-aud"), true);
    assert.equal(await t(W.audienceTeam, "rock", "r-aud"), true);
    assert.equal(await allowed(getDoc(doc(dbFor(W.audiencePerson), "rock_status_updates/su-r-aud"))), true);
    // Milestone assignee: their milestone and its thread, never the rock.
    assert.equal(await t(W.offTeamAssignee, "todo", "m-r-none"), true);
    assert.equal(await allowed(getDoc(doc(dbFor(W.offTeamAssignee), "rocks/r-none"))), false);
    assert.equal(await t(W.offTeamAssignee, "rock", "r-none"), false);
    // milestone_owner_ids grants nothing; a private rock has no audience.
    assert.equal(await allowed(getDoc(doc(dbFor(W.offTeamAssignee), "rocks/r-mo"))), false);
    assert.equal(await allowed(getDoc(doc(dbFor(W.audienceTeam), "rocks/r-priv"))), false);
    // Public metric: every person.
    assert.equal(await allowed(getDoc(doc(dbFor(W.outsider), "scorecard_metrics/mt-public"))), true);
    assert.equal(await allowed(getDoc(doc(dbFor(W.outsider), `scorecard_entries/mt-public__${WEEK}`))), true);
    assert.equal(await allowed(getDoc(doc(dbFor(W.outsider), "scorecard_metrics/mt-home"))), false);
  });
});

// ---------- 3. hand-rolled queries ----------

describe("hand-rolled client queries the UI never makes are refused", () => {
  const refused = async (w: Who, q: Query) => {
    await assertFails(getDocs(q));
  };

  test("todos on a team without pinning visibility (would include private rows)", async () => {
    await refused(W.parentLeader, query(collection(dbFor(W.parentLeader), "todos"), where("team_id", "==", P)));
  });

  test("a team's private to-dos by visibility alone", async () => {
    const db = dbFor(W.parentLeader);
    await refused(W.parentLeader, query(collection(db, "todos"), where("team_id", "==", P), where("visibility", "==", "private")));
  });

  test("whole collections", async () => {
    for (const col of ["rocks", "todos", "entity_comments", "entity_activity", "rock_status_updates", "scorecard_metrics", "notifications", "users", "teams", "team_members"]) {
      await refused(W.parentMember, query(collection(dbFor(W.parentMember), col)));
    }
  });

  test("threads by team_id alone (the filing team grants nothing)", async () => {
    const db = dbFor(W.parentMember);
    await refused(W.parentMember, query(collection(db, "entity_comments"), where("team_id", "==", P)));
    await refused(W.parentMember, query(collection(db, "entity_activity"), where("team_id", "==", P)));
  });

  test("the directory: users / teams / team_members / organizations", async () => {
    const db = dbFor(W.parentMember);
    await refused(W.parentMember, query(collection(db, "team_members"), where("team_id", "==", P)));
    await assertFails(getDoc(doc(db, "users/u-mem")));
  });
});

// ---------- known gap ----------

describe("KNOWN GAP: list queries are proven statically", () => {
  // A list rule is checked against the query's filters, not each stored
  // document; an unfiltered field read with `.get(field, default)` takes the
  // default. The private-creator clause excludes milestones with
  // `!isMilestone(t)`, and for a query that does not filter source_rock_id
  // that reads as "not a milestone". So the creator of a LEGACY private
  // milestone who has lost the rock can still list it by hand (the doc read
  // is refused). The app's own created_by query runs only on the viewer's
  // team, where they see the rock anyway. Closes when P13 normalises
  // milestones to visibility "team".
  test("creator of a legacy private milestone, hand-rolled list on a team they are not on", async () => {
    const db = dbFor(W.privateCreator);
    const snap = await getDocs(
      query(collection(db, "todos"), where("team_id", "==", P), where("visibility", "==", "private"), where("created_by", "==", "u-crt")),
    );
    assert.deepEqual(snap.docs.map((d) => d.id).sort(), ["m-priv-legacy", "t-priv-crt"]);
    assert.equal(moduleSees("todos/m-priv-legacy", W.privateCreator.viewer), false);
    await assertFails(getDoc(doc(db, "todos/m-priv-legacy")));
  });
});

// ---------- lookup budget ----------

describe("lookup budget", () => {
  test(`scorecard_entries: a ${RULES_GET_IN_LIMIT}-id chunk (one metric get each + myTeamIds) is allowed`, async () => {
    const extra = Array.from({ length: 30 }, (_, i) => `mt-bulk-${i}`);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await Promise.all(
        extra.flatMap((id) => [
          setDoc(doc(db, `scorecard_metrics/${id}`), { team_id: P, shared_team_ids: [] }),
          setDoc(doc(db, `scorecard_entries/${id}__${WEEK}`), { metric_id: id, week_start_date: WEEK }),
        ]),
      );
    });
    const db = dbFor(W.parentMember);
    const entries = (chunk: string[]) =>
      getDocs(query(collection(db, "scorecard_entries"), where("metric_id", "in", chunk), where("week_start_date", ">=", "2026-01-01")));
    for (const chunk of chunkForInQuery(extra, RULES_GET_IN_LIMIT)) {
      const snap = await entries(chunk);
      assert.equal(snap.size, chunk.length);
    }
    // Why the client chunks small: 30 ids = 31 lookups, refused outright.
    await assertFails(entries(extra));
  });

  test("milestone thread (to-do + rock + users = 3 lookups) on a full rock", async () => {
    const snap = await getDocs(
      query(collection(dbFor(W.audiencePerson), "entity_comments"), where("entity_type", "==", "todo"), where("entity_id", "==", "m-r-aud")),
    );
    assert.equal(snap.size, 1);
  });
});
