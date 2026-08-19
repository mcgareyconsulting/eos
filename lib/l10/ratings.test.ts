import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ratingWriteAllowed } from "./ratings";

describe("ratingWriteAllowed", () => {
  test("live meeting: create or update is allowed", () => {
    assert.equal(
      ratingWriteAllowed({ meetingEnded: false, alreadyRated: false }),
      true,
    );
    assert.equal(
      ratingWriteAllowed({ meetingEnded: false, alreadyRated: true }),
      true,
    );
  });

  test("concluded meeting: first write is allowed (recap catch-up)", () => {
    assert.equal(
      ratingWriteAllowed({ meetingEnded: true, alreadyRated: false }),
      true,
    );
  });

  test("concluded meeting: rewriting an existing score is rejected", () => {
    assert.equal(
      ratingWriteAllowed({ meetingEnded: true, alreadyRated: true }),
      false,
    );
  });
});
