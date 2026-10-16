import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_ISSUE_PREFIX,
  autoTitleFor,
  captureSubmission,
  captureTitleMissing,
  defaultCaptureKind,
  titleAfterKindSwitch,
  type CaptureDraft,
} from "./capture";

describe("defaultCaptureKind", () => {
  test("reporting stages open on Issue", () => {
    for (const s of ["segue", "scorecard", "rocks", "headlines", "todos"] as const) {
      assert.equal(defaultCaptureKind(s), "issue", s);
    }
  });

  test("Issues and Conclude open on To-do", () => {
    assert.equal(defaultCaptureKind("issues"), "todo");
    assert.equal(defaultCaptureKind("conclude"), "todo");
  });
});

describe("autoTitleFor", () => {
  test("an issue starts with the stage's prefix", () => {
    assert.equal(autoTitleFor("issue", "scorecard"), "Off-track metric: ");
    assert.equal(autoTitleFor("issue", "segue"), "From segue: ");
    assert.equal(autoTitleFor("issue", "rocks"), "Off-track rock: ");
    assert.equal(autoTitleFor("issue", "headlines"), "From headline: ");
    assert.equal(autoTitleFor("issue", "todos"), "Stale to-do: ");
    assert.equal(autoTitleFor("issue", "issues"), "");
  });

  test("a to-do never gets a prefix", () => {
    for (const s of Object.keys(CAPTURE_ISSUE_PREFIX) as (keyof typeof CAPTURE_ISSUE_PREFIX)[]) {
      assert.equal(autoTitleFor("todo", s), "", s);
    }
  });
});

describe("titleAfterKindSwitch", () => {
  test("an untouched prefix clears when switching to To-do", () => {
    assert.deepEqual(
      titleAfterKindSwitch({
        title: "Off-track metric: ",
        autoTitle: "Off-track metric: ",
        to: "todo",
        segment: "scorecard",
      }),
      { title: "", autoTitle: "" },
    );
  });

  test("an empty untouched title takes the prefix when switching to Issue", () => {
    assert.deepEqual(
      titleAfterKindSwitch({ title: "", autoTitle: "", to: "issue", segment: "rocks" }),
      { title: "Off-track rock: ", autoTitle: "Off-track rock: " },
    );
  });

  test("switching back and forth without typing round-trips", () => {
    let state = { title: "From segue: ", autoTitle: "From segue: " };
    state = titleAfterKindSwitch({ ...state, to: "todo", segment: "segue" });
    state = titleAfterKindSwitch({ ...state, to: "issue", segment: "segue" });
    assert.deepEqual(state, { title: "From segue: ", autoTitle: "From segue: " });
  });

  test("typed text after the prefix is preserved", () => {
    assert.deepEqual(
      titleAfterKindSwitch({
        title: "Off-track metric: churn",
        autoTitle: "Off-track metric: ",
        to: "todo",
        segment: "scorecard",
      }),
      { title: "Off-track metric: churn", autoTitle: "Off-track metric: " },
    );
  });

  test("a to-do title typed from scratch is preserved when switching to Issue", () => {
    const out = titleAfterKindSwitch({
      title: "Call the vendor",
      autoTitle: "",
      to: "issue",
      segment: "headlines",
    });
    assert.equal(out.title, "Call the vendor");
  });

  test("an edited prefix counts as typed", () => {
    const out = titleAfterKindSwitch({
      title: "Off-track metric:",
      autoTitle: "Off-track metric: ",
      to: "todo",
      segment: "scorecard",
    });
    assert.equal(out.title, "Off-track metric:");
  });
});

describe("captureTitleMissing", () => {
  test("blank or prefix-only titles are missing", () => {
    assert.equal(captureTitleMissing("   ", ""), true);
    assert.equal(captureTitleMissing("From segue: ", "From segue: "), true);
  });

  test("anything typed is a title", () => {
    assert.equal(captureTitleMissing("From segue: new hire", "From segue: "), false);
    assert.equal(captureTitleMissing("Fix the report", ""), false);
  });
});

describe("captureSubmission", () => {
  const draft: CaptureDraft = {
    kind: "issue",
    title: "Off-track metric: churn",
    ownerId: "u1",
    description: "notes",
    due: "2026-10-23",
    weeklyFocus: true,
    followerIds: ["u2", "u3"],
    priority: "high",
    term: "long",
  };
  const asMap = (fields: [string, string][]) =>
    fields.reduce<Record<string, string[]>>((m, [k, v]) => {
      (m[k] ??= []).push(v);
      return m;
    }, {});

  test("an Issue routes to addIssue with term, priority and the meeting", () => {
    const { action, fields } = captureSubmission(draft, "m1");
    assert.equal(action, "addIssue");
    const m = asMap(fields);
    assert.deepEqual(m.title, ["Off-track metric: churn"]);
    assert.deepEqual(m.type, ["long"]);
    assert.deepEqual(m.priority, ["high"]);
    assert.deepEqual(m.owner_id, ["u1"]);
    assert.deepEqual(m.description, ["notes"]);
    assert.deepEqual(m.source_meeting_id, ["m1"]);
    // To-do-only fields never reach addIssue.
    assert.equal(m.due_date, undefined);
    assert.equal(m.follower_ids, undefined);
    assert.equal(m.weekly_focus, undefined);
  });

  test("a To-do routes to addTodo, team-visible, with due date and followers", () => {
    const { action, fields } = captureSubmission({ ...draft, kind: "todo" }, "m1");
    assert.equal(action, "addTodo");
    const m = asMap(fields);
    assert.deepEqual(m.due_date, ["2026-10-23"]);
    assert.deepEqual(m.visibility, ["team"]);
    assert.deepEqual(m.weekly_focus, ["on"]);
    assert.deepEqual(m.follower_ids, ["u2", "u3"]);
    assert.deepEqual(m.source_meeting_id, ["m1"]);
    // Issue-only fields never reach addTodo.
    assert.equal(m.type, undefined);
    assert.equal(m.priority, undefined);
  });

  test("weekly focus off sends no flag", () => {
    const { fields } = captureSubmission(
      { ...draft, kind: "todo", weeklyFocus: false },
      "m1",
    );
    assert.equal(asMap(fields).weekly_focus, undefined);
  });
});
