import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LONG_TEXT_MAX, TITLE_MAX, requireMaxLength } from "./text-limits";

describe("requireMaxLength", () => {
  test("caps are 500 for titles and 20,000 for long text", () => {
    assert.equal(TITLE_MAX, 500);
    assert.equal(LONG_TEXT_MAX, 20_000);
  });

  test("accepts values up to and including the cap", () => {
    requireMaxLength("x".repeat(TITLE_MAX), TITLE_MAX, "Title");
    requireMaxLength("x".repeat(LONG_TEXT_MAX), LONG_TEXT_MAX, "Notes");
  });

  test("refuses one character over, in the comment-cap message format", () => {
    assert.throws(
      () => requireMaxLength("x".repeat(TITLE_MAX + 1), TITLE_MAX, "Title"),
      new Error("Title too long (max 500 chars)"),
    );
    assert.throws(
      () => requireMaxLength("x".repeat(LONG_TEXT_MAX + 1), LONG_TEXT_MAX, "Description"),
      new Error("Description too long (max 20000 chars)"),
    );
  });

  test("null, undefined and empty are not a length question", () => {
    requireMaxLength(null, TITLE_MAX, "Title");
    requireMaxLength(undefined, TITLE_MAX, "Title");
    requireMaxLength("", TITLE_MAX, "Title");
  });
});
