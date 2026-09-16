import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  canDrive,
  isStaleLiveMeeting,
  isUnclaimed,
  shouldOfferTakeover,
  STALE_MEETING_MS,
} from "./driver";

describe("canDrive", () => {
  const base = { driverId: "joe", uid: "joe", isAdmin: false };

  test("the driver drives", () => {
    assert.equal(canDrive(base), true);
  });

  test("a member who is not the driver does not", () => {
    // They are not blocked from the room — they take the wheel first.
    assert.equal(canDrive({ ...base, uid: "steph" }), false);
  });

  test("org admin keeps the bypass it has everywhere else", () => {
    assert.equal(canDrive({ ...base, uid: "sre", isAdmin: true }), true);
  });

  test("an unclaimed meeting is drivable by any member", () => {
    // Every meeting started before `driver_id` shipped. No backfill: the first
    // transport action claims it.
    assert.equal(canDrive({ driverId: null, uid: "steph", isAdmin: false }), true);
    assert.equal(
      canDrive({ driverId: undefined, uid: "steph", isAdmin: false }),
      true,
    );
    assert.equal(canDrive({ driverId: "", uid: "steph", isAdmin: false }), true);
  });
});

describe("isUnclaimed", () => {
  test("null, undefined and empty all mean nobody holds the wheel", () => {
    assert.equal(isUnclaimed(null), true);
    assert.equal(isUnclaimed(undefined), true);
    assert.equal(isUnclaimed(""), true);
  });

  test("a uid means someone does", () => {
    assert.equal(isUnclaimed("joe"), false);
  });
});

describe("shouldOfferTakeover", () => {
  const base = {
    driverId: "joe",
    uid: "steph",
    isAdmin: false,
    ended: false,
  };

  test("offered to a member while someone else drives", () => {
    assert.equal(shouldOfferTakeover(base), true);
  });

  test("not offered to the driver", () => {
    assert.equal(shouldOfferTakeover({ ...base, uid: "joe" }), false);
  });

  test("not offered on an unclaimed meeting — the transport is already theirs", () => {
    assert.equal(shouldOfferTakeover({ ...base, driverId: null }), false);
  });

  test("not offered once the meeting has ended", () => {
    assert.equal(shouldOfferTakeover({ ...base, ended: true }), false);
  });

  test("offered to an admin who is not the driver", () => {
    // Admins can drive without it, but the room should still see the handoff
    // rather than watch the stage move under someone else's name.
    assert.equal(shouldOfferTakeover({ ...base, isAdmin: true }), true);
  });

  test("never both drives and offers a takeover to the same viewer", () => {
    // The rail renders transport when canDrive and the takeover button
    // otherwise; a viewer who got both (or neither) would be a dead end.
    const uids = ["joe", "steph"];
    const drivers: (string | null)[] = ["joe", null];
    for (const uid of uids) {
      for (const driverId of drivers) {
        for (const isAdmin of [true, false]) {
          const drive = canDrive({ driverId, uid, isAdmin });
          const takeover = shouldOfferTakeover({
            driverId,
            uid,
            isAdmin,
            ended: false,
          });
          assert.equal(
            drive || takeover,
            true,
            `dead end for uid=${uid} driver=${driverId} admin=${isAdmin}`,
          );
          // An admin is the one viewer allowed both: they may drive outright,
          // and may still take the wheel so the room sees who has it.
          if (!isAdmin) {
            assert.equal(
              drive && takeover,
              false,
              `both for uid=${uid} driver=${driverId}`,
            );
          }
        }
      }
    }
  });
});

describe("isStaleLiveMeeting", () => {
  const now = Date.UTC(2026, 8, 16, 17, 0, 0);

  test("a meeting from ten minutes ago is today's room", () => {
    assert.equal(
      isStaleLiveMeeting({ lastActivityMs: now - 10 * 60_000, nowMs: now }),
      false,
    );
  });

  test("a meeting that ran long is still today's room", () => {
    // Four hours in the Issues segment is a bad meeting, not an abandoned one.
    assert.equal(
      isStaleLiveMeeting({ lastActivityMs: now - 4 * 60 * 60_000, nowMs: now }),
      false,
    );
  });

  test("last week's un-Finished meeting is not this week's", () => {
    assert.equal(
      isStaleLiveMeeting({
        lastActivityMs: now - 7 * 24 * 60 * 60_000,
        nowMs: now,
      }),
      true,
    );
  });

  test("the boundary is exclusive — exactly at the cutoff still joins", () => {
    assert.equal(
      isStaleLiveMeeting({ lastActivityMs: now - STALE_MEETING_MS, nowMs: now }),
      false,
    );
    assert.equal(
      isStaleLiveMeeting({
        lastActivityMs: now - STALE_MEETING_MS - 1,
        nowMs: now,
      }),
      true,
    );
  });

  test("a doc with no timestamps is stale, not joinable", () => {
    // Hand-seeded or half-written: joining a room of unknown age is the worse
    // failure, because it silently carries stale votes into a live L10.
    assert.equal(isStaleLiveMeeting({ lastActivityMs: null, nowMs: now }), true);
  });
});
