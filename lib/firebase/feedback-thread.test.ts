import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeFirestore } from "../test-support/fake-firestore";
import type { DirectoryPerson } from "./directory";
import { loadItem, loadViewers } from "./items";
import { emitEvent } from "./notifications";
import { autoFollow } from "./follow";
import {
  canCommentItem,
  mentionPeopleOf,
  pickerPeopleOf,
  threadAudienceLine,
} from "./thread-gate";
import { blockedMentionMessage, candidatesFromPeople, resolveMentions } from "../mentions";
import { itemLabel, notificationHref } from "../notifications";

// A feedback tracker item's thread runs through the shared comment path
// (entity-comments/actions.ts → thread gate, mentions, emitEvent) with the
// tracker's access list as its access module. These tests drive that path
// with the list resolved by a fake (ViewerDeps.feedbackAccessUids) — the
// real resolver (list + Auth by email) is in feedback-access.test.ts.
//
// steph and dan are listed; boss is an org admin and lead a team leader,
// neither listed; joe is on a team, not listed.

const LISTED = ["steph", "dan"];
const deps = {
  adminUids: async () => new Set(["boss", "dan"]),
  feedbackAccessUids: async () => [...LISTED],
};
const UIDS = ["steph", "dan", "boss", "lead", "joe"];

function seed(): FakeFirestore {
  const f = new FakeFirestore();
  f.seed("teams", "T", { name: "ESD" });
  f.seed("team_members", "T__lead", { team_id: "T", user_id: "lead", role: "leader" });
  f.seed("team_members", "T__joe", { team_id: "T", user_id: "joe", role: "member" });
  f.seed("team_members", "T__steph", { team_id: "T", user_id: "steph", role: "member" });
  f.seed("feedback_items", "fb-036", {
    number: 36,
    summary: "Error message while entering weekly scorecard data",
    original_comment: "got this message",
    comment_display: "Got this message when entering my data for this week.",
    status: "completed",
    created_by: "dan",
    // A stored list never grants access: only the resolved one does.
    access_uids: ["joe"],
    follower_ids: ["joe", "lead"],
  });
  return f;
}

async function feedback(f: FakeFirestore) {
  return (await loadItem(f.asFirestore(), { type: "feedback", id: "fb-036" }, deps))!;
}

function person(uid: string, name: string, access: DirectoryPerson["access"] = "member"): DirectoryPerson {
  const [firstName, ...rest] = name.split(" ");
  return { uid, firstName, lastName: rest.join(" "), email: null, teams: [], access };
}

const DIRECTORY: DirectoryPerson[] = [
  person("steph", "Steph Benes"),
  person("dan", "Daniel McGarey", "admin"),
  person("boss", "Bo Admin", "admin"),
  person("lead", "Lee Lead", "leader"),
  person("joe", "Joe Creighton"),
];

function rows(f: FakeFirestore) {
  return f.docsIn("notifications").map((d) => d.data);
}

describe("feedback thread — who may read and post", () => {
  test("listed people only: an unlisted org admin or leader is refused", async () => {
    const f = seed();
    const item = await feedback(f);
    const viewers = await loadViewers(f.asFirestore(), UIDS, deps);
    assert.deepEqual(
      UIDS.filter((u) => canCommentItem(item, viewers.get(u)!)),
      ["steph", "dan"],
    );
  });

  test("the subject is the resolved list, never a field on the doc", async () => {
    const item = await feedback(seed());
    assert.deepEqual(item.subject, { access_uids: LISTED });
    assert.equal(item.teamId, "");
  });

  test("an unreadable list lets nobody in", async () => {
    const f = seed();
    const item = (await loadItem(
      f.asFirestore(),
      { type: "feedback", id: "fb-036" },
      { feedbackAccessUids: async () => [] },
    ))!;
    const viewers = await loadViewers(f.asFirestore(), UIDS, deps);
    assert.deepEqual(UIDS.filter((u) => canCommentItem(item, viewers.get(u)!)), []);
  });
});

describe("feedback thread — @mentions", () => {
  test("the picker lists only the people on the access list", async () => {
    const item = await feedback(seed());
    const picker = candidatesFromPeople(pickerPeopleOf(item, mentionPeopleOf(item, DIRECTORY)));
    assert.deepEqual(
      picker.map((c) => [c.id, c.disabled]),
      [
        ["steph", false],
        ["dan", false],
      ],
    );
  });

  test("other item types keep listing everyone, the unseeing greyed", async () => {
    const f = seed();
    f.seed("issues", "i1", { team_id: "T", owner_id: "joe" });
    const issue = (await loadItem(f.asFirestore(), { type: "issue", id: "i1" }))!;
    const people = mentionPeopleOf(issue, DIRECTORY);
    assert.equal(pickerPeopleOf(issue, people).length, DIRECTORY.length);
  });

  test("a typed mention of someone not on the list is refused, by name", async () => {
    const item = await feedback(seed());
    const people = mentionPeopleOf(item, DIRECTORY);
    const { ids, blocked } = resolveMentions("@Steph Benes and @Bo Admin, see this", people);
    assert.deepEqual(ids, ["steph"]);
    assert.deepEqual(blocked.map((b) => b.id), ["boss"]);
    assert.match(blockedMentionMessage(blocked), /Bo Admin cannot see this item/);
  });

  test("'Visible to' names the access list, not admins or a team", async () => {
    const f = seed();
    assert.equal(
      await threadAudienceLine(f.asFirestore(), await feedback(f)),
      "Visible to the people with feedback tracker access.",
    );
  });
});

describe("feedback thread — notifications", () => {
  test("mentioned listed people get an in-app mention; nobody else hears", async () => {
    const f = seed();
    const n = await emitEvent(f.asFirestore(), { type: "feedback", id: "fb-036" }, "comment", "steph", {
      teamId: "",
      direct: { mention: ["dan"] },
      viewerDeps: deps,
    });
    assert.equal(n, 1);
    const [row] = rows(f);
    assert.equal(row.user_id, "dan");
    assert.equal(row.kind, "mention");
    assert.equal(row.entity_type, "feedback");
    assert.equal(row.entity_id, "fb-036");
    // Its link is the tracker's modal.
    assert.equal(notificationHref(row as never), "/admin/feedback?item=fb-036");
  });

  test("a mentioned person who is not listed is dropped at send time", async () => {
    const f = seed();
    const n = await emitEvent(f.asFirestore(), { type: "feedback", id: "fb-036" }, "comment", "steph", {
      teamId: "",
      direct: { mention: ["boss", "joe", "lead"] },
      viewerDeps: deps,
    });
    assert.equal(n, 0);
    assert.deepEqual(rows(f), []);
  });

  test("stored follower_ids and the creator are not followers: no comment fan-out", async () => {
    const f = seed();
    // dan created it, joe and lead are in a stored follower_ids: none hear.
    await emitEvent(f.asFirestore(), { type: "feedback", id: "fb-036" }, "comment", "steph", {
      teamId: "",
      viewerDeps: deps,
    });
    assert.deepEqual(rows(f), []);
  });

  test("auto-follow writes nothing to the tracker's item", async () => {
    const f = seed();
    const added = await autoFollow(f.asFirestore(), { type: "feedback", id: "fb-036" }, ["steph", "dan"], deps, "steph");
    assert.deepEqual(added, []);
    const doc = f.docsIn("feedback_items").find((d) => d.id === "fb-036")!.data;
    assert.deepEqual(doc.follower_ids, ["joe", "lead"]);
    assert.equal(doc.updated_at, undefined);
  });

  test("the hub's label: FB number + summary, the reporter's words", () => {
    const f = seed();
    const data = f.docsIn("feedback_items")[0].data;
    assert.deepEqual(itemLabel("feedback", data), {
      title: "FB-036 · Error message while entering weekly scorecard data",
      snippet: "Got this message when entering my data for this week.",
    });
    assert.deepEqual(itemLabel("feedback", { number: 7 }), { title: "FB-007", snippet: null });
  });
});
