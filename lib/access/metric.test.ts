import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  addShare,
  canArchiveMetric,
  canDeleteMetric,
  canEditMetricValues,
  isOnScorecard,
  isSharedIntoTeam,
} from "@/lib/scorecard-share";
import { metricAccess, type MetricSubject } from "./metric";
import {
  actionTeams,
  ALL_TEAMS,
  PARENT,
  SHARED,
  UNRELATED,
  VIEWER_ENTRIES,
  VIEWERS,
} from "./test-viewers";

const METRICS: Record<string, MetricSubject> = {
  home: { team_id: PARENT, owner_id: VIEWERS.parentMember.uid },
  tracked: {
    team_id: PARENT,
    owner_id: VIEWERS.parentMember.uid,
    shared_team_ids: [SHARED],
  },
  ownedByLeader: { team_id: PARENT, owner_id: VIEWERS.parentLeader.uid },
  ownedOffTeam: {
    team_id: PARENT,
    owner_id: VIEWERS.sharedMember.uid,
    shared_team_ids: [SHARED],
  },
  archived: {
    team_id: PARENT,
    owner_id: VIEWERS.parentMember.uid,
    shared_team_ids: [SHARED],
    archived_at: { seconds: 1 },
  },
  ownerless: { team_id: PARENT, owner_id: null },
  full: {
    team_id: PARENT,
    owner_id: VIEWERS.parentMember.uid,
    shared_team_ids: ["a", "b", "c", "d", "e", "f", "g", "h"],
  },
};

describe("metricAccess — parity with lib/scorecard-share.ts", () => {
  for (const [metricName, metric] of Object.entries(METRICS)) {
    for (const [viewerName, v] of VIEWER_ENTRIES) {
      test(`${metricName} × ${viewerName}`, () => {
        const teams = actionTeams(v);
        const args = (teamId: string) => ({
          metric,
          teamId,
          uid: v.uid,
          isAdmin: v.isAdmin,
        });
        assert.equal(
          metricAccess.canEditValues(metric, v),
          teams.some((t) => canEditMetricValues(args(t))),
          "canEditValues",
        );
        assert.equal(
          metricAccess.canDelete(metric, v),
          teams.some((t) => canDeleteMetric(args(t))),
          "canDelete",
        );
        assert.equal(
          metricAccess.canArchive(metric, v),
          teams.some((t) => canArchiveMetric(args(t))),
          "canArchive",
        );
        assert.equal(
          metricAccess.canSee(metric, v),
          v.isAdmin || teams.some((t) => isOnScorecard(metric, t)),
          "canSee",
        );
        for (const t of ALL_TEAMS) {
          const gate = teams.includes(t);
          assert.equal(
            metricAccess.canTrack(metric, v, t),
            gate && addShare(metric, t).ok,
            `canTrack ${t}`,
          );
          assert.equal(
            metricAccess.canUntrack(metric, v, t),
            gate && isSharedIntoTeam(metric, t),
            `canUntrack ${t}`,
          );
        }
        assert.equal(metricAccess.canComment(metric, v), false, "no thread");
        assert.equal(metricAccess.canFollow(metric, v), false, "no follow yet");
        assert.equal(metricAccess.canMention(metric, v), metricAccess.canSee(metric, v));
      });
    }
  }
});

describe("metricAccess — current behaviour, spelled out", () => {
  const m = METRICS.tracked;

  test("home team + tracking team + admin see it; nobody else", () => {
    assert.equal(metricAccess.canSee(m, VIEWERS.admin), true);
    assert.equal(metricAccess.canSee(m, VIEWERS.parentMember), true);
    assert.equal(metricAccess.canSee(m, VIEWERS.sharedMember), true);
    assert.equal(metricAccess.canSee(m, VIEWERS.outsider), false);
  });

  test("a tracking team reads but never edits the definition or values", () => {
    assert.equal(metricAccess.canEdit(m, VIEWERS.sharedMember), false);
    assert.equal(metricAccess.canEditValues(m, VIEWERS.sharedMember), false);
    assert.equal(metricAccess.canEdit(m, VIEWERS.parentMember), true);
    assert.equal(metricAccess.canEditValues(m, VIEWERS.parentMember), true);
  });

  test("archived beats everything for values, admin included", () => {
    assert.equal(metricAccess.canEditValues(METRICS.archived, VIEWERS.admin), false);
  });

  test("archive/delete: owner on the home team, or admin — not a leader (SPEC P7)", () => {
    assert.equal(metricAccess.canDelete(m, VIEWERS.parentMember), true);
    assert.equal(metricAccess.canDelete(m, VIEWERS.admin), true);
    assert.equal(metricAccess.canDelete(m, VIEWERS.parentLeader), false);
    // The owner, but off the home team: no.
    assert.equal(metricAccess.canDelete(METRICS.ownedOffTeam, VIEWERS.sharedMember), false);
  });

  test("any member can track any metric onto their team (no public flag yet)", () => {
    assert.equal(metricAccess.canTrack(METRICS.home, VIEWERS.outsider, UNRELATED), true);
    assert.equal(metricAccess.canTrack(METRICS.home, VIEWERS.outsider, SHARED), false);
    assert.equal(metricAccess.canTrack(METRICS.home, VIEWERS.parentMember, PARENT), false);
    assert.equal(metricAccess.canTrack(METRICS.full, VIEWERS.outsider, UNRELATED), false);
    assert.equal(metricAccess.canUntrack(m, VIEWERS.sharedMember, SHARED), true);
    assert.equal(metricAccess.canUntrack(m, VIEWERS.parentMember, PARENT), false);
  });
});
