import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFeedbackItem } from "./model";
import {
  bankToday,
  changedEditFields,
  feedbackEditFormFrom,
  feedbackEditFormToPatch,
  parseLines,
  withShippedAtFill,
} from "./edit";

describe("form parsing", () => {
  test("parseLines drops blank lines and trims", () => {
    assert.deepEqual(parseLines("  a \r\n\n b\n   \n"), ["a", "b"]);
    assert.deepEqual(parseLines(""), []);
  });

  test("the form → a validated patch; other keys ignored", () => {
    const patch = feedbackEditFormToPatch({
      status: "building",
      client_resolution: " Fixed. ",
      resolution: "",
      client_note: "",
      follow_up_with: "Steph",
      follow_up_topic: "",
      follow_ups: "Ask Jenna\n\nAsk Joe",
      prs: "93 40",
      // ^ not a form field any more: ignored, like the other non-form keys.
      evidence: "PR #40 merged",
      shipped_at: "",
      original_comment: "rewritten",
      number: 99,
    });
    assert.deepEqual(patch, {
      status: "building",
      client_resolution: "Fixed.",
      resolution: null,
      client_note: null,
      follow_up_with: "Steph",
      follow_up_topic: null,
      follow_ups: ["Ask Jenna", "Ask Joe"],
      evidence: ["PR #40 merged"],
      shipped_at: null,
    });
  });

  test("absent keys are left out of the patch", () => {
    assert.deepEqual(feedbackEditFormToPatch({ resolution: " x " }), { resolution: "x" });
    assert.deepEqual(feedbackEditFormToPatch({ evidence: "a\nb", status: undefined }), { evidence: ["a", "b"] });
    assert.deepEqual(feedbackEditFormToPatch({}), {});
  });

  test("changedEditFields: only what differs from the opened values", () => {
    const opened = feedbackEditFormFrom(readFeedbackItem("fb-001", { number: 1, status: "new", prs: [4] }));
    assert.deepEqual(changedEditFields(opened, opened), {});
    assert.deepEqual(changedEditFields({ ...opened, resolution: "r" }, opened), { resolution: "r" });
  });

  test("bad values are refused with readable text", () => {
    const ok = feedbackEditFormFrom(readFeedbackItem("fb-001", { number: 1, status: "new" }));
    assert.throws(() => feedbackEditFormToPatch({ ...ok, status: "closed" }), /Unknown status "closed"/);
    assert.throws(() => feedbackEditFormToPatch({ ...ok, shipped_at: "Oct 1" }), /Shipped date/);
    assert.throws(() => feedbackEditFormToPatch({ ...ok, resolution: 7 }), /must be text/);
  });

  test("feedbackEditFormFrom round-trips through the patch", () => {
    const item = readFeedbackItem("fb-002", {
      number: 2,
      status: "completed",
      client_resolution: "Done",
      prs: [12, 40],
      evidence: ["a", "b"],
      follow_ups: ["x"],
      shipped_at: "2026-09-02",
    });
    const patch = feedbackEditFormToPatch(feedbackEditFormFrom(item));
    assert.equal(patch.status, "completed");
    assert.equal("prs" in patch, false, "PRs are kept but not edited in the UI");
    assert.deepEqual(patch.evidence, ["a", "b"]);
    assert.equal(patch.shipped_at, "2026-09-02");
  });
});

describe("withShippedAtFill", () => {
  const TODAY = "2026-10-19";

  test("moving to Completed or Deployed with no date fills today", () => {
    for (const to of ["completed", "deployed"] as const) {
      assert.deepEqual(
        withShippedAtFill({ status: "building", shipped_at: null }, { status: to }, TODAY),
        { status: to, shipped_at: TODAY },
      );
      // The form sends an empty date as null: still filled.
      assert.deepEqual(
        withShippedAtFill({ status: "new", shipped_at: null }, { status: to, shipped_at: null }, TODAY),
        { status: to, shipped_at: TODAY },
      );
    }
  });

  test("an existing or typed date wins", () => {
    assert.deepEqual(
      withShippedAtFill({ status: "building", shipped_at: "2026-09-01" }, { status: "completed" }, TODAY),
      { status: "completed" },
    );
    assert.deepEqual(
      withShippedAtFill({ status: "building", shipped_at: null }, { status: "completed", shipped_at: "2026-10-01" }, TODAY),
      { status: "completed", shipped_at: "2026-10-01" },
    );
  });

  test("no fill without a status change into a shipped status", () => {
    assert.deepEqual(withShippedAtFill({ status: "completed", shipped_at: null }, { status: "completed" }, TODAY), {
      status: "completed",
    });
    assert.deepEqual(withShippedAtFill({ status: "deployed", shipped_at: null }, { status: "completed" }, TODAY), {
      status: "completed",
      shipped_at: TODAY,
    });
    for (const to of ["new", "building", "answered", "follow_up", "postponed"] as const) {
      assert.deepEqual(withShippedAtFill({ status: "completed", shipped_at: null }, { status: to }, TODAY), { status: to });
    }
    assert.deepEqual(withShippedAtFill({ status: "new", shipped_at: null }, { resolution: "x" }, TODAY), { resolution: "x" });
  });

  test("bankToday is the Denver calendar day", () => {
    // 2026-10-20 04:30 UTC is still the 19th in Denver (MDT, UTC-6).
    assert.equal(bankToday(new Date("2026-10-20T04:30:00Z")), "2026-10-19");
    assert.equal(bankToday(new Date("2026-10-20T07:00:00Z")), "2026-10-20");
  });
});
