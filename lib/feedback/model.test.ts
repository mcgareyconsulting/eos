import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LONG_TEXT_MAX, TITLE_MAX } from "@/lib/text-limits";
import {
  FEEDBACK_SHORT_TEXT_MAX,
  boardColumnFor,
  changedFeedbackFields,
  feedbackCreateActivity,
  feedbackDocId,
  feedbackEditActivity,
  feedbackLabel,
  isFeedbackDocId,
  newFeedbackItem,
  prList,
  readFeedbackActivity,
  readFeedbackItem,
  screenshotList,
  shippedAt,
  textList,
  validateFeedbackPatch,
  validateNewFeedback,
} from "./model";
import {
  FEEDBACK_BOARD_COLUMNS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
} from "./types";

describe("ids", () => {
  test("fb-<number padded to 3>", () => {
    assert.equal(feedbackDocId(1), "fb-001");
    assert.equal(feedbackDocId(59), "fb-059");
    assert.equal(feedbackDocId(1234), "fb-1234");
    assert.equal(feedbackLabel(37), "FB-037");
  });

  test("rejects non-positive and non-integer numbers", () => {
    for (const n of [0, -1, 1.5, Number.NaN]) assert.throws(() => feedbackDocId(n));
  });

  test("isFeedbackDocId", () => {
    assert.equal(isFeedbackDocId("fb-001"), true);
    assert.equal(isFeedbackDocId("fb-1234"), true);
    for (const bad of ["fb-1", "FB-001", "fb-001/x", "", null, 1]) {
      assert.equal(isFeedbackDocId(bad), false, String(bad));
    }
  });
});

describe("statuses and board", () => {
  test("exactly the seven statuses, each labelled", () => {
    assert.deepEqual(
      [...FEEDBACK_STATUSES],
      ["new", "building", "deployed", "completed", "answered", "follow_up", "postponed"],
    );
    assert.equal(FEEDBACK_STATUS_LABELS.follow_up, "Follow-up");
    assert.equal(Object.keys(FEEDBACK_STATUS_LABELS).length, 7);
  });

  test("board columns: every status in exactly one; Done = Completed + Answered", () => {
    assert.deepEqual(
      FEEDBACK_BOARD_COLUMNS.map((c) => c.label),
      ["New", "Building", "Deployed", "Follow-up", "Postponed", "Done"],
    );
    for (const s of FEEDBACK_STATUSES) {
      assert.equal(FEEDBACK_BOARD_COLUMNS.filter((c) => c.statuses.includes(s)).length, 1, s);
    }
    assert.equal(boardColumnFor("completed").id, "done");
    assert.equal(boardColumnFor("answered").id, "done");
    assert.equal(boardColumnFor("follow_up").label, "Follow-up");
  });
});

const NEW = {
  reported_on: "2026-10-19",
  reviewer: "  Steph Benes ",
  page: "Rocks",
  type: "bug",
  original_comment: "  The rock page  is slow \n",
};

describe("validateNewFeedback", () => {
  test("trims fields; the comment keeps its inner text verbatim", () => {
    const f = validateNewFeedback(NEW);
    assert.equal(f.reviewer, "Steph Benes");
    assert.equal(f.original_comment, "The rock page  is slow");
    assert.equal(f.summary, null);
    assert.deepEqual(f.screenshots, []);
  });

  test("required fields and enums", () => {
    assert.throws(() => validateNewFeedback({ ...NEW, original_comment: "   " }), /Comment is required/);
    assert.throws(() => validateNewFeedback({ ...NEW, reviewer: "" }), /Reported by is required/);
    assert.throws(() => validateNewFeedback({ ...NEW, page: undefined }), /Page is required/);
    assert.throws(() => validateNewFeedback({ ...NEW, type: "closed" }), /Unknown type/);
    assert.throws(() => validateNewFeedback({ ...NEW, reported_on: "2026-02-30" }), /date/);
    assert.throws(() => validateNewFeedback({ ...NEW, reported_on: "10/19/2026" }), /date/);
  });

  test("length caps", () => {
    assert.throws(
      () => validateNewFeedback({ ...NEW, original_comment: "x".repeat(LONG_TEXT_MAX + 1) }),
      /too long/,
    );
    assert.throws(() => validateNewFeedback({ ...NEW, summary: "x".repeat(TITLE_MAX + 1) }), /too long/);
    assert.throws(
      () => validateNewFeedback({ ...NEW, reviewer: "x".repeat(FEEDBACK_SHORT_TEXT_MAX + 1) }),
      /too long/,
    );
  });

  test("newFeedbackItem starts at status new with empty resolution fields", () => {
    const item = newFeedbackItem(validateNewFeedback(NEW), { number: 60, createdBy: "admin-1" });
    assert.equal(item.status, "new");
    assert.equal(item.number, 60);
    assert.equal(item.sheet_row, null);
    assert.equal(item.created_by, "admin-1");
    assert.equal(item.client_resolution, null);
    assert.deepEqual(item.prs, []);
  });
});

describe("field validators", () => {
  test("textList trims, drops empties, de-duplicates, caps", () => {
    assert.deepEqual(textList([" a ", "", "a", "b", null], 10, "X"), ["a", "b"]);
    assert.throws(() => textList("a", 10, "X"), /must be a list/);
    assert.throws(() => textList(["x".repeat(11)], 10, "X"), /too long/);
    assert.throws(() => textList(Array.from({ length: 51 }, (_, i) => `e${i}`), 10, "X"), /at most 50/);
  });

  test("prList: positive integers, unique, ascending", () => {
    assert.deepEqual(prList([93, 18, 93]), [18, 93]);
    assert.throws(() => prList([0]));
    assert.throws(() => prList(["18"]));
  });

  test("screenshotList: image basenames only", () => {
    assert.deepEqual(screenshotList(["row02.png", "shot.JPG"]), ["row02.png", "shot.JPG"]);
    for (const bad of ["screenshots/row02.png", "../x.png", "row02.exe", ".png"]) {
      assert.throws(() => screenshotList([bad]), /image file name/, bad);
    }
  });

  test("shippedAt: date, ISO date-time, or empty", () => {
    assert.equal(shippedAt("2026-08-04"), "2026-08-04");
    assert.equal(shippedAt("2026-08-04T15:33:38Z"), "2026-08-04T15:33:38Z");
    assert.equal(shippedAt(""), null);
    assert.equal(shippedAt(null), null);
    assert.throws(() => shippedAt("2026-08-04 15:33"));
    assert.throws(() => shippedAt("2026-13-01"));
  });
});

describe("validateFeedbackPatch", () => {
  test("any status to any status; enum enforced", () => {
    for (const s of FEEDBACK_STATUSES) assert.equal(validateFeedbackPatch({ status: s }).status, s);
    assert.throws(() => validateFeedbackPatch({ status: "closed" }), /Unknown status/);
  });

  test("normalizes values; undefined is absent; empty text clears to null", () => {
    const p = validateFeedbackPatch({
      client_resolution: "  Fixed.  ",
      resolution: "",
      prs: [40, 12],
      summary: undefined,
    });
    assert.deepEqual(p, { client_resolution: "Fixed.", resolution: null, prs: [12, 40] });
  });

  test("never-edited and unknown fields are refused", () => {
    for (const key of ["original_comment", "number", "sheet_row", "created_by", "thread", "internal_note"]) {
      assert.throws(() => validateFeedbackPatch({ [key]: "x" }), /cannot be edited/, key);
    }
  });
});

describe("change detection and activity", () => {
  const current = readFeedbackItem("fb-001", {
    number: 1,
    status: "building",
    client_resolution: "Old",
    prs: [12],
    evidence: [],
  });

  test("changedFeedbackFields compares values, arrays element-wise", () => {
    assert.deepEqual(changedFeedbackFields(current, { status: "building", prs: [12] }), []);
    assert.deepEqual(
      changedFeedbackFields(current, { prs: [12, 40], client_resolution: "Old", resolution: null }),
      ["prs"],
    );
    assert.deepEqual(changedFeedbackFields(current, { client_resolution: "New", status: "completed" }), [
      "status",
      "client_resolution",
    ]);
  });

  test("a status change logs from/to and the other fields", () => {
    assert.deepEqual(feedbackEditActivity("building", { status: "completed", prs: [40] }, ["status", "prs"], "a1"), {
      actor_uid: "a1",
      kind: "status",
      from: "building",
      to: "completed",
      fields: ["prs"],
    });
    assert.deepEqual(feedbackEditActivity("new", { status: "building" }, ["status"], "a1"), {
      actor_uid: "a1",
      kind: "status",
      from: "new",
      to: "building",
    });
  });

  test("any other change is an edited row", () => {
    assert.deepEqual(feedbackEditActivity("new", { resolution: "x" }, ["resolution"], "a1"), {
      actor_uid: "a1",
      kind: "edited",
      fields: ["resolution"],
    });
    assert.deepEqual(feedbackCreateActivity("imported", "system", "completed"), {
      actor_uid: "system",
      kind: "imported",
      to: "completed",
    });
  });
});

describe("read model", () => {
  test("fills defaults and converts timestamps", () => {
    const at = { toDate: () => new Date("2026-10-19T12:00:00Z") };
    const item = readFeedbackItem("fb-002", { number: 2, status: "bogus", created_at: at });
    assert.equal(item.status, "new");
    assert.equal(item.created_at, "2026-10-19T12:00:00.000Z");
    assert.equal(item.updated_at, null);
    assert.deepEqual(item.screenshots, []);
    assert.equal(item.thread, null);
    assert.equal(readFeedbackItem("fb-006", { thread: "Steph 10/13 asked Jenna" }).thread, "Steph 10/13 asked Jenna");
    const act = readFeedbackActivity("a", { at, actor_uid: "u", kind: "status", from: "new", to: "x" });
    assert.deepEqual(act, { id: "a", at: "2026-10-19T12:00:00.000Z", actor_uid: "u", kind: "status", from: "new" });
  });
});
