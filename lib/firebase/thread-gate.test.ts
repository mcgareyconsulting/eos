import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "../test-support/fake-firestore";
import { loadItem, loadViewers } from "./items";
import type { DirectoryPerson } from "./directory";
import {
  canCommentItem,
  mentionPeopleOf,
  threadAudienceLine,
} from "./thread-gate";
import {
  blockedMentionMessage,
  candidatesFromPeople,
  resolveMentions,
} from "../mentions";
import type { ItemType } from "../item-registry";

/**
 * Team T (ESD): lead, mem. Team O: asg (assignee), mate. Team A: aud (rock
 * audience team member). `pat` is a rock audience person on no team. `boss`
 * is an org admin on no team. `out` is on an unrelated team.
 */
function seed(): FakeFirestore {
  const f = new FakeFirestore();
  f.seed("teams", "T", { name: "ESD" });
  f.seed("teams", "A", { name: "Lending" });
  f.seed("team_members", "T__lead", { team_id: "T", user_id: "lead", role: "leader" });
  f.seed("team_members", "T__mem", { team_id: "T", user_id: "mem", role: "member" });
  f.seed("team_members", "O__asg", { team_id: "O", user_id: "asg", role: "member" });
  f.seed("team_members", "O__mate", { team_id: "O", user_id: "mate", role: "member" });
  f.seed("team_members", "A__aud", { team_id: "A", user_id: "aud", role: "member" });
  f.seed("team_members", "X__out", { team_id: "X", user_id: "out", role: "member" });
  f.seed("rocks", "r1", {
    team_id: "T",
    owner_id: "mem",
    audience_team_ids: ["A"],
    audience_user_ids: ["pat"],
  });
  f.seed("todos", "team", { team_id: "T", owner_id: "asg", created_by: "mem", visibility: "team" });
  f.seed("todos", "priv", { team_id: "T", owner_id: "asg", created_by: "mem", visibility: "private" });
  f.seed("todos", "ms", { team_id: "T", owner_id: "asg", visibility: "team", source_rock_id: "r1" });
  f.seed("issues", "i1", { team_id: "T", owner_id: "mem" });
  f.seed("headlines", "h1", { team_id: "T", created_by: "mem" });
  return f;
}

const UIDS = ["lead", "mem", "asg", "mate", "aud", "pat", "out", "boss"];

async function whoCanComment(f: FakeFirestore, type: ItemType, id: string) {
  const db = f.asFirestore();
  const item = (await loadItem(db, { type, id }))!;
  const viewers = await loadViewers(db, UIDS, {
    adminUids: async () => new Set(["boss"]),
  });
  return UIDS.filter((u) => canCommentItem(item, viewers.get(u)!));
}

describe("canCommentItem — one gate for every thread type", () => {
  test("issue and headline: the parent team and admins", async () => {
    const f = seed();
    assert.deepEqual(await whoCanComment(f, "issue", "i1"), ["lead", "mem", "boss"]);
    assert.deepEqual(await whoCanComment(f, "headline", "h1"), ["lead", "mem", "boss"]);
  });

  test("rock: the parent team, the audience team and person, admins", async () => {
    assert.deepEqual(await whoCanComment(seed(), "rock", "r1"), [
      "lead",
      "mem",
      "aud",
      "pat",
      "boss",
    ]);
  });

  test("team to-do: the parent team, the off-team assignee, admins", async () => {
    assert.deepEqual(await whoCanComment(seed(), "todo", "team"), [
      "lead",
      "mem",
      "asg",
      "boss",
    ]);
  });

  test("private to-do: creator, assignee, admins (leaders have no power)", async () => {
    assert.deepEqual(await whoCanComment(seed(), "todo", "priv"), ["mem", "asg", "boss"]);
  });

  test("milestone (a todo ref reclassified): rock set plus its assignee", async () => {
    assert.deepEqual(await whoCanComment(seed(), "todo", "ms"), [
      "lead",
      "mem",
      "asg",
      "aud",
      "pat",
      "boss",
    ]);
  });
});

function person(
  uid: string,
  name: string,
  teams: { id: string; role?: string }[],
  access: DirectoryPerson["access"] = "member",
): DirectoryPerson {
  const [firstName, ...rest] = name.split(" ");
  return {
    uid,
    firstName,
    lastName: rest.join(" "),
    email: null,
    teams: teams.map((t) => ({ id: t.id, name: t.id, role: t.role ?? "member" })),
    access,
  };
}

const DIRECTORY: DirectoryPerson[] = [
  person("lead", "Lee Lead", [{ id: "T", role: "leader" }], "leader"),
  person("mem", "Mia Member", [{ id: "T" }]),
  person("asg", "Ann Assignee", [{ id: "O" }]),
  person("aud", "Al Audience", [{ id: "A" }]),
  person("pat", "Pat Person", []),
  person("out", "Olly Outsider", [{ id: "X" }]),
  person("boss", "Bo Admin", [], "admin"),
];

function canSeeMap(people: ReturnType<typeof mentionPeopleOf>) {
  return Object.fromEntries(people.map((p) => [p.id, p.canSee]));
}

describe("mentionPeopleOf — candidates come from the access module, not the roster", () => {
  test("a team to-do: the off-team assignee and admins can be mentioned", async () => {
    const item = (await loadItem(seed().asFirestore(), { type: "todo", id: "team" }))!;
    assert.deepEqual(canSeeMap(mentionPeopleOf(item, DIRECTORY)), {
      lead: true,
      mem: true,
      asg: true,
      aud: false,
      pat: false,
      out: false,
      boss: true,
    });
  });

  test("a rock: the audience team and the audience person can be mentioned", async () => {
    const item = (await loadItem(seed().asFirestore(), { type: "rock", id: "r1" }))!;
    const seen = canSeeMap(mentionPeopleOf(item, DIRECTORY));
    assert.equal(seen.aud, true);
    assert.equal(seen.pat, true);
    assert.equal(seen.asg, false);
    assert.equal(seen.out, false);
  });

  test("an issue: only the team and admins; others are greyed candidates", async () => {
    const item = (await loadItem(seed().asFirestore(), { type: "issue", id: "i1" }))!;
    const cands = candidatesFromPeople(mentionPeopleOf(item, DIRECTORY));
    assert.equal(cands.find((c) => c.id === "asg")?.disabled, true);
    assert.equal(cands.find((c) => c.id === "mem")?.disabled, false);
  });
});

describe("the server refuses a mention of someone who cannot see the item", () => {
  test("a clear error naming them, not a silent drop", async () => {
    const item = (await loadItem(seed().asFirestore(), { type: "issue", id: "i1" }))!;
    const people = mentionPeopleOf(item, DIRECTORY);
    const { ids, blocked } = resolveMentions("cc @Mia Member and @Olly Outsider", people);
    assert.deepEqual(ids, ["mem"]);
    assert.deepEqual(blocked.map((b) => b.id), ["out"]);
    assert.match(blockedMentionMessage(blocked), /Olly Outsider cannot see this item/);
  });

  test("a headline refuses the same way; an allowed mention passes", async () => {
    const item = (await loadItem(seed().asFirestore(), { type: "headline", id: "h1" }))!;
    const people = mentionPeopleOf(item, DIRECTORY);
    assert.equal(resolveMentions("@Ann Assignee?", people).blocked.length, 1);
    assert.deepEqual(resolveMentions("@Bo Admin fyi", people), { ids: ["boss"], blocked: [] });
  });
});

describe("threadAudienceLine — 'Visible to …'", () => {
  test("rock names the parent team, the audience and admins", async () => {
    const f = seed();
    const item = (await loadItem(f.asFirestore(), { type: "rock", id: "r1" }))!;
    assert.equal(
      await threadAudienceLine(f.asFirestore(), item),
      "Visible to ESD, this rock's audience (Lending and 1 named person) and admins.",
    );
  });

  test("issue, team to-do and private to-do", async () => {
    const f = seed();
    const db = f.asFirestore();
    const line = async (type: ItemType, id: string) =>
      threadAudienceLine(db, (await loadItem(db, { type, id }))!);
    assert.equal(await line("issue", "i1"), "Visible to ESD and admins.");
    assert.equal(await line("todo", "team"), "Visible to ESD, the assignee and admins.");
    assert.equal(
      await line("todo", "priv"),
      "Visible to the creator, the assignee and admins.",
    );
  });
});
