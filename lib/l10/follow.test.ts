import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isDetached, shouldFollowRefresh, shouldReattach } from "./follow";

describe("shouldFollowRefresh", () => {
  const base = {
    following: true,
    ended: false,
    activeSegment: "rocks",
    viewSegment: "segue",
    lastFollowed: null as string | null,
  };

  test("pulls an attached viewer over when the leader advances", () => {
    assert.equal(shouldFollowRefresh(base), true);
  });

  test("leaves a detached viewer alone", () => {
    // The whole point of the opt-out: the group never moves them again.
    assert.equal(shouldFollowRefresh({ ...base, following: false }), false);
  });

  test("does nothing once the meeting has ended", () => {
    // The recap redirect owns that transition.
    assert.equal(shouldFollowRefresh({ ...base, ended: true }), false);
  });

  test("does nothing when already on the group's stage", () => {
    assert.equal(
      shouldFollowRefresh({ ...base, viewSegment: "rocks" }),
      false,
    );
  });

  test("fires once per stage change, not once per snapshot", () => {
    // A refresh is in flight for `rocks`; further snapshots must not queue more.
    assert.equal(
      shouldFollowRefresh({ ...base, lastFollowed: "rocks" }),
      false,
    );
    // ...but the next stage is a fresh ask.
    assert.equal(
      shouldFollowRefresh({
        ...base,
        activeSegment: "issues",
        lastFollowed: "rocks",
      }),
      true,
    );
  });
});

describe("isDetached", () => {
  test("true only when the viewer chose to step away", () => {
    assert.equal(
      isDetached({
        following: false,
        activeSegment: "rocks",
        viewSegment: "segue",
      }),
      true,
    );
  });

  test("false for an attached viewer mid-refresh", () => {
    // Transiently on the old stage while the follow refresh lands — showing a
    // Catch up pill here would flash at someone already being caught up.
    assert.equal(
      isDetached({
        following: true,
        activeSegment: "rocks",
        viewSegment: "segue",
      }),
      false,
    );
  });

  test("false when a detached viewer's stage happens to match the group", () => {
    // Nothing to catch up to, so no pill. shouldReattach then clears the
    // detached flag outright — see below.
    assert.equal(
      isDetached({
        following: false,
        activeSegment: "rocks",
        viewSegment: "rocks",
      }),
      false,
    );
  });
});

describe("shouldReattach", () => {
  const base = {
    following: false,
    ended: false,
    activeSegment: "rocks",
    viewSegment: "rocks",
  };

  test("re-attaches when the group arrives at the stage you stepped away to", () => {
    assert.equal(shouldReattach(base), true);
  });

  test("leaves a detached viewer alone while the group is elsewhere", () => {
    // This is the state the Catch up pill is for; it must not resolve itself.
    assert.equal(
      shouldReattach({ ...base, activeSegment: "issues" }),
      false,
    );
  });

  test("is a no-op for someone already attached", () => {
    assert.equal(shouldReattach({ ...base, following: true }), false);
  });

  test("does nothing once the meeting has ended", () => {
    assert.equal(shouldReattach({ ...base, ended: true }), false);
  });

  test("never fires at the same time as a follow refresh", () => {
    // The two effects are mutually exclusive by construction: one needs
    // following, the other needs !following. Pinned so a later edit to either
    // predicate cannot let both drive the router on one render.
    for (const following of [true, false]) {
      for (const activeSegment of ["rocks", "issues"]) {
        const state = { ...base, following, activeSegment };
        const follow = shouldFollowRefresh({ ...state, lastFollowed: null });
        assert.equal(
          follow && shouldReattach(state),
          false,
          `both fired for following=${following} active=${activeSegment}`,
        );
      }
    }
  });
});
