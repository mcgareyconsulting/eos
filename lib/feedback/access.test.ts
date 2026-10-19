import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAccessChanges,
  hasFeedbackAccess,
  normalizeAccessEmail,
  parseAccessArgs,
  readAccessEmails,
} from "./access";

const LIST = ["steph@example.com", "joe@example.com"];

describe("hasFeedbackAccess", () => {
  test("listed → yes; not listed → no", () => {
    assert.equal(hasFeedbackAccess({ email: "steph@example.com", emailVerified: true }, LIST), true);
    assert.equal(hasFeedbackAccess({ email: "other@example.com", emailVerified: true }, LIST), false);
  });

  test("case-insensitive and trimmed", () => {
    assert.equal(hasFeedbackAccess({ email: "  Joe@Example.COM " }, LIST), true);
  });

  test("fails closed: no list, empty list, no email, unverified email", () => {
    assert.equal(hasFeedbackAccess({ email: "steph@example.com" }, null), false);
    assert.equal(hasFeedbackAccess({ email: "steph@example.com" }, []), false);
    assert.equal(hasFeedbackAccess({ email: null }, LIST), false);
    assert.equal(hasFeedbackAccess({ email: undefined }, LIST), false);
    assert.equal(hasFeedbackAccess({ email: "" }, LIST), false);
    assert.equal(hasFeedbackAccess({ email: "steph@example.com", emailVerified: false }, LIST), false);
  });

  test("no email_verified claim at all is allowed (the claim is only checked when present)", () => {
    assert.equal(hasFeedbackAccess({ email: "steph@example.com", emailVerified: undefined }, LIST), true);
    assert.equal(hasFeedbackAccess({ email: "steph@example.com", emailVerified: null }, LIST), true);
  });
});

describe("readAccessEmails", () => {
  test("normalizes, de-duplicates and drops junk", () => {
    assert.deepEqual(readAccessEmails({ emails: [" Steph@Example.com", "steph@example.com", 7, "nope", "joe@example.com"] }), [
      "steph@example.com",
      "joe@example.com",
    ]);
    assert.deepEqual(readAccessEmails(undefined), []);
    assert.deepEqual(readAccessEmails({ emails: "steph@example.com" }), []);
  });
});

describe("script arguments", () => {
  test("normalizeAccessEmail", () => {
    assert.equal(normalizeAccessEmail(" A@B.Co "), "a@b.co");
    for (const bad of ["a@b", "a b@c.d", "@b.co", "a@", "", 5, null]) assert.equal(normalizeAccessEmail(bad), null, String(bad));
  });

  test("parses list / add / remove / apply / actor and skips target flags", () => {
    assert.deepEqual(parseAccessArgs(["--", "--target", "sandbox", "--list"]), {
      list: true,
      add: [],
      remove: [],
      apply: false,
      actor: null,
    });
    assert.deepEqual(
      parseAccessArgs(["--target", "prod", "--add", "A@x.com", "--add", "b@x.com", "--remove", "c@x.com", "--apply", "--actor", "uid-1"]),
      { list: false, add: ["a@x.com", "b@x.com"], remove: ["c@x.com"], apply: true, actor: "uid-1" },
    );
  });

  test("refuses bad calls", () => {
    assert.throws(() => parseAccessArgs([]), /Nothing to do/);
    assert.throws(() => parseAccessArgs(["--add", "not-an-email"]), /not an email/);
    assert.throws(() => parseAccessArgs(["--add"]), /needs a value/);
    assert.throws(() => parseAccessArgs(["--add", "--apply"]), /needs a value/);
    assert.throws(() => parseAccessArgs(["--list", "--apply"]), /--apply needs/);
    assert.throws(() => parseAccessArgs(["--add", "a@x.com", "--remove", "A@x.com"]), /Both added and removed/);
    assert.throws(() => parseAccessArgs(["--grant", "a@x.com"]), /Unknown argument/);
  });

  test("applyAccessChanges keeps order, appends, de-duplicates", () => {
    assert.deepEqual(applyAccessChanges(["a@x.com", "b@x.com"], ["c@x.com", "a@x.com"], ["b@x.com"]), [
      "a@x.com",
      "c@x.com",
    ]);
    assert.deepEqual(applyAccessChanges([], ["a@x.com", "a@x.com"], []), ["a@x.com"]);
  });
});
