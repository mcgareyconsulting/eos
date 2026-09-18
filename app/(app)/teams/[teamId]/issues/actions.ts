"use server";

import { revalidatePath } from "next/cache";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";
import { MAX_VOTES_PER_TEAM, PRIORITY_LABEL } from "@/lib/issues";
import { selectIssuesClosedDuringMeeting } from "@/lib/todos-archive";
import { notify } from "@/lib/firebase/notifications";
import { recordActivity } from "@/lib/firebase/activity";
import { liveMeetingRoom } from "@/lib/firebase/meeting-room";
import { loadUserNames } from "@/lib/firebase/user-names";
import {
  followersAfterOwnerChange,
  initialFollowers,
  recipientsFor,
  summarizeIssueChanges,
  toggleFollower,
  type NotificationKind,
} from "@/lib/notifications";
import type { ActivityKind } from "@/lib/activity";

const STATUSES = ["open", "solving", "solved", "dropped"] as const;
type Status = (typeof STATUSES)[number];

const TYPES = ["short", "long"] as const;
type Type = (typeof TYPES)[number];

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
type Priority = (typeof PRIORITIES)[number];

function pathFor(teamId: string) {
  return `/teams/${teamId}/issues`;
}

function followerIdsOf(data: FirebaseFirestore.DocumentData): string[] {
  return Array.isArray(data.follower_ids)
    ? data.follower_ids.filter((x): x is string => typeof x === "string")
    : [];
}

/** The pieces every issue notification needs — see lib/notifications.ts. */
function notifyTarget(
  teamId: string,
  teamName: string,
  issueId: string,
  data: FirebaseFirestore.DocumentData,
) {
  return {
    team: { id: teamId, name: teamName },
    entity: {
      type: "issue" as const,
      id: issueId,
      title: String(data.title ?? "Issue"),
    },
  };
}

function activityEntity(issueId: string, data: FirebaseFirestore.DocumentData) {
  return {
    type: "issue" as const,
    id: issueId,
    ownerId: data.owner_id as string | null | undefined,
  };
}

/**
 * Tell the issue's followers about an event, minus whoever caused it and
 * whoever is sitting in the team's live L10 (lib/notifications.ts
 * recipientsFor). The trace is written separately and unconditionally.
 */
async function notifyFollowers(args: {
  db: Firestore;
  teamId: string;
  teamName: string;
  issueId: string;
  data: FirebaseFirestore.DocumentData;
  followerIds: readonly string[];
  actorId: string;
  kind: NotificationKind;
  detail?: string | null;
  /** Left out of the fan-out because they got a row of their own. */
  except?: readonly string[];
}) {
  const except = new Set(args.except ?? []);
  const recipientIds = recipientsFor({
    followerIds: args.followerIds,
    actorId: args.actorId,
    ownerId: args.data.owner_id as string | null | undefined,
    inRoomIds: await liveMeetingRoom(args.db, args.teamId),
  }).filter((id) => !except.has(id));
  await notify({
    db: args.db,
    recipientIds,
    kind: args.kind,
    ...notifyTarget(args.teamId, args.teamName, args.issueId, args.data),
    actor: { id: args.actorId },
    detail: args.detail ?? null,
  });
}

// A single, optional owner id — never a list. An empty/missing selection
// clears the owner rather than defaulting to a made-up value.
function readOwnerId(formData: FormData, fallback: string | null): string | null {
  const raw = formData.get("owner_id");
  if (raw === null) return fallback;
  const trimmed = String(raw).trim();
  return trimmed || null;
}

function readPriority(formData: FormData): Priority | null {
  const raw = String(formData.get("priority") ?? "").trim();
  return PRIORITIES.includes(raw as Priority) ? (raw as Priority) : null;
}

// Long-term issues aren't the IDS/discuss target — clear any live meeting
// pin so "Discussing" doesn't stick after the issue leaves short-term.
async function clearLiveMeetingPin(
  db: Firestore,
  teamId: string,
  issueId: string,
) {
  // Team meeting history is small; filter in memory to avoid a composite index.
  const meetings = await db
    .collection("meetings")
    .where("team_id", "==", teamId)
    .get();
  const openPinned = meetings.docs.filter(
    (d) =>
      d.data()?.ended_at == null && d.data()?.current_issue_id === issueId,
  );
  if (openPinned.length > 0) {
    const batch = db.batch();
    for (const d of openPinned) {
      batch.update(d.ref, { current_issue_id: null });
    }
    await batch.commit();
  }
}

export async function addIssue(teamId: string, formData: FormData) {
  const { uid, db, team } = await requireTeamAccess(teamId);

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const typeRaw = String(formData.get("type") ?? "short");
  const type: Type = TYPES.includes(typeRaw as Type)
    ? (typeRaw as Type)
    : "short";
  const owner_id = readOwnerId(formData, uid);
  const priority = readPriority(formData);
  // Durable link back to the L10 the issue was raised in (set by in-meeting
  // surfaces). The recap currently infers membership from the meeting time
  // window; capturing the id from now on lets it become exact later.
  const source_meeting_id =
    String(formData.get("source_meeting_id") ?? "").trim() || null;

  if (!title) throw new Error("Title required");

  // Whoever raised it and whoever owns it follow from the start — the
  // subscribe shape N31 settled on, same as to-dos. Anyone else opts in from
  // the issue's detail (setIssueFollowing).
  const follower_ids = initialFollowers({ creatorId: uid, ownerId: owner_id });

  const ref = await db.collection("issues").add({
    team_id: teamId,
    title,
    description,
    owner_id,
    priority,
    votes: 0,
    type,
    status: "open",
    resolved_at: null,
    archived_at: null,
    resolution_todo_id: null,
    source_meeting_id,
    created_by: uid,
    follower_ids,
    created_at: FieldValue.serverTimestamp(),
  });

  if (owner_id && owner_id !== uid) {
    await notify({
      db,
      recipientIds: [owner_id],
      kind: "assigned",
      ...notifyTarget(teamId, team.name, ref.id, { title }),
      actor: { id: uid },
      detail: priority ? `Priority ${PRIORITY_LABEL[priority]}` : null,
    });
  }
  const names = await loadUserNames(db, owner_id ? [owner_id] : []);
  await recordActivity({
    db,
    teamId,
    entity: { type: "issue", id: ref.id, ownerId: owner_id },
    kind: "created",
    actor: { id: uid },
    detail: [
      `Owner ${
        !owner_id
          ? "unassigned"
          : owner_id === uid
            ? "you"
            : names.get(owner_id) ?? "—"
      }`,
      type === "long" ? "Long-term" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  });

  revalidatePath(pathFor(teamId));
}

// Edits triage fields on an issue (title, owner, priority, type, description).
// Status and votes stay on their own affordances.
export async function updateIssueMeta(
  teamId: string,
  issueId: string,
  formData: FormData,
) {
  const { uid, db, team } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "issues", issueId, teamId);
  const data = snap.data() ?? {};
  const prevType = data.type;
  const prevOwner = (data.owner_id as string | null | undefined) ?? null;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title required");

  const typeRaw = String(formData.get("type") ?? "short");
  const type: Type = TYPES.includes(typeRaw as Type)
    ? (typeRaw as Type)
    : "short";
  const owner_id = readOwnerId(formData, null);
  const priority = readPriority(formData);
  const description = String(formData.get("description") ?? "").trim() || null;

  // A new owner starts following; nobody is dropped (the old owner handed it
  // off and still wants to know it got solved — Unfollow is one click).
  const reassigned = owner_id !== prevOwner;
  const follower_ids = reassigned
    ? followersAfterOwnerChange(followerIdsOf(data), owner_id)
    : followerIdsOf(data);

  await db.collection("issues").doc(issueId).update({
    title,
    type,
    owner_id,
    priority,
    description,
    follower_ids,
  });

  // Moving to long-term via the edit modal needs the same live-meeting pin
  // cleanup as setIssueType.
  if (type === "long" && prevType !== "long") {
    await clearLiveMeetingPin(db, teamId, issueId);
  }

  // Tell followers what moved. The new owner hears "assigned you" instead
  // of the generic summary; the actor hears nothing either way.
  const names = await loadUserNames(db, owner_id ? [owner_id] : []);
  const summary = summarizeIssueChanges(
    {
      title: String(data.title ?? ""),
      owner_id: prevOwner,
      priority: (data.priority as string | null) ?? null,
      type: (data.type as string | null) ?? null,
    },
    { title, owner_id, priority, type },
    (id) => names.get(id),
  );
  const after = { ...data, title, owner_id };
  if (summary) {
    const assigned = reassigned && owner_id && owner_id !== uid ? [owner_id] : [];
    await notify({
      db,
      recipientIds: assigned,
      kind: "assigned",
      ...notifyTarget(teamId, team.name, issueId, after),
      actor: { id: uid },
      detail: priority ? `Priority ${PRIORITY_LABEL[priority]}` : null,
    });
    await notifyFollowers({
      db,
      teamId,
      teamName: team.name,
      issueId,
      data: after,
      followerIds: follower_ids,
      actorId: uid,
      kind: "updated",
      detail: summary,
      except: assigned,
    });
  }

  // The trace records every change the form made, told or not.
  const entity = activityEntity(issueId, after);
  const actor = { id: uid };
  if (summary) {
    await recordActivity({ db, teamId, entity, kind: "updated", actor, detail: summary });
  }
  const prevDescription = String(data.description ?? "").trim() || null;
  if (prevDescription !== description) {
    await recordActivity({ db, teamId, entity, kind: "description", actor });
  }

  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
}

/**
 * Follow or unfollow an issue — the explicit half of the follow relation
 * (whoever raised it and whoever owns it follow automatically; anyone else
 * on the team opts in from the issue's detail, and anyone can opt out).
 */
export async function setIssueFollowing(
  teamId: string,
  issueId: string,
  following: boolean,
) {
  const { uid, db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "issues", issueId, teamId);
  const data = snap.data() ?? {};
  await db
    .collection("issues")
    .doc(issueId)
    .update({ follower_ids: toggleFollower(followerIdsOf(data), uid, following) });
  await recordActivity({
    db,
    teamId,
    entity: activityEntity(issueId, data),
    kind: following ? "followed" : "unfollowed",
    actor: { id: uid },
  });
  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
}

// Cast a vote on this issue (delta = +1 or -1). Each person has 3 vote credits
// on this team (not a shared team pool) and can stack multiple credits on a
// single issue. Atomic across:
//  - the user's per-issue credit count (issue_votes.count)
//  - the user's total credits across the team (sum of count, capped at 3)
//  - the issue's denormalized counter (issues.votes)
export async function castVote(
  teamId: string,
  issueId: string,
  delta: 1 | -1,
) {
  const { uid, db } = await requireTeamAccess(teamId);
  if (delta !== 1 && delta !== -1) throw new Error("Bad delta");

  await db.runTransaction(async (tx) => {
    const voteId = `${issueId}__${uid}`;
    const voteRef = db.collection("issue_votes").doc(voteId);
    const issueRef = db.collection("issues").doc(issueId);

    // Reads first (Firestore transaction rule). Also reads the issue itself
    // so we can verify it belongs to this team before voting on it, and the
    // team's live meeting to check the voting window is open.
    const [voteSnap, issueSnap, liveSnap] = await Promise.all([
      tx.get(voteRef),
      tx.get(issueRef),
      tx.get(
        db
          .collection("meetings")
          .where("team_id", "==", teamId)
          .where("ended_at", "==", null)
          .limit(1),
      ),
    ]);
    if (!issueSnap.exists || issueSnap.data()?.team_id !== teamId) {
      throw new Error("Issue not found");
    }

    // The vote window is the rule, not a UI convenience. Checked inside
    // the transaction so closing the vote and casting one cannot interleave.
    //
    // Voting exists only inside an L10 — `VoteButton` renders on the meeting's
    // Issues segment and nowhere else — so "no live meeting" is not a
    // permissive case to fall through, it is a stale tab.
    const votingOpen =
      !liveSnap.empty && liveSnap.docs[0].data()?.voting_open === true;
    if (!votingOpen) {
      throw new Error(
        "Voting isn't open. Start the vote from the Issues segment first.",
      );
    }
    const currentCount = voteSnap.exists
      ? Number(voteSnap.data()?.count ?? 0)
      : 0;

    if (delta === 1) {
      const allMine = await tx.get(
        db
          .collection("issue_votes")
          .where("user_id", "==", uid)
          .where("team_id", "==", teamId),
      );
      const totalUsed = allMine.docs.reduce(
        (sum, d) => sum + Number(d.data().count ?? 0),
        0,
      );
      if (totalUsed >= MAX_VOTES_PER_TEAM) {
        throw new Error(
          `Out of vote credits (${MAX_VOTES_PER_TEAM} per person). Remove one first.`,
        );
      }
    } else if (currentCount <= 0) {
      // Nothing to subtract.
      return;
    }

    const nextCount = currentCount + delta;
    if (nextCount <= 0) {
      tx.delete(voteRef);
    } else if (voteSnap.exists) {
      tx.update(voteRef, { count: nextCount });
    } else {
      tx.set(voteRef, {
        issue_id: issueId,
        user_id: uid,
        team_id: teamId,
        count: nextCount,
        created_at: FieldValue.serverTimestamp(),
      });
    }
    tx.update(issueRef, { votes: FieldValue.increment(delta) });
  });

  revalidatePath(pathFor(teamId));
}

export async function setIssueStatus(
  teamId: string,
  issueId: string,
  status: string,
) {
  if (!STATUSES.includes(status as Status)) throw new Error("Bad status");
  const { uid, db, team } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "issues", issueId, teamId);
  const data = snap.data() ?? {};
  const prevStatus = String(data.status ?? "open");
  const update: Record<string, unknown> = { status };
  if (status === "solved" || status === "dropped") {
    update.resolved_at = FieldValue.serverTimestamp();
  } else {
    // Re-open clears close timestamp so it won't archive as "closed this week".
    update.resolved_at = null;
  }
  await db.collection("issues").doc(issueId).update(update);

  if (status !== prevStatus) {
    const event = statusEvent(status as Status, prevStatus);
    if (event.notify) {
      await notifyFollowers({
        db,
        teamId,
        teamName: team.name,
        issueId,
        data,
        followerIds: followerIdsOf(data),
        actorId: uid,
        kind: event.notify,
        detail: event.detail,
      });
    }
    await recordActivity({
      db,
      teamId,
      entity: activityEntity(issueId, data),
      kind: event.activity,
      actor: { id: uid },
    });
  }

  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
}

/**
 * What a status transition is called. Solved and dropped are the events a
 * follower waits for; taking it up (Solving) is worth a row in the trace
 * but not a bell. Back to Open from a closed state is a reopen; from
 * Solving it is just a step back, traced only.
 */
function statusEvent(
  status: Status,
  prevStatus: string,
): { activity: ActivityKind; notify: NotificationKind | null; detail: string | null } {
  switch (status) {
    case "solved":
      return { activity: "completed", notify: "completed", detail: null };
    case "dropped":
      return { activity: "dropped", notify: "dropped", detail: null };
    case "solving":
      return { activity: "solving", notify: null, detail: null };
    case "open": {
      const wasClosed = prevStatus === "solved" || prevStatus === "dropped";
      return {
        activity: "reopened",
        notify: wasClosed ? "reopened" : null,
        detail: null,
      };
    }
  }
}

/** Move an issue between short-term and long-term parking lot. */
export async function setIssueType(
  teamId: string,
  issueId: string,
  type: string,
) {
  if (!TYPES.includes(type as Type)) throw new Error("Bad type");
  const { uid, db, team } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "issues", issueId, teamId);
  const data = snap.data() ?? {};
  const prevType = data.type === "long" ? "long" : "short";
  await db.collection("issues").doc(issueId).update({ type });

  if (type === "long") {
    await clearLiveMeetingPin(db, teamId, issueId);
  }

  if (type !== prevType) {
    const detail = type === "long" ? "Moved to long-term" : "Moved to short-term";
    await notifyFollowers({
      db,
      teamId,
      teamName: team.name,
      issueId,
      data,
      followerIds: followerIdsOf(data),
      actorId: uid,
      kind: "moved",
      detail,
    });
    await recordActivity({
      db,
      teamId,
      entity: activityEntity(issueId, data),
      kind: type === "long" ? "term_long" : "term_short",
      actor: { id: uid },
    });
  }

  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
}

export async function deleteIssue(teamId: string, issueId: string) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "issues", issueId, teamId);
  // Cascade: issue + votes + comments (entity_comments)
  const [votes, comments] = await Promise.all([
    db.collection("issue_votes").where("issue_id", "==", issueId).get(),
    db
      .collection("entity_comments")
      .where("team_id", "==", teamId)
      .where("entity_type", "==", "issue")
      .where("entity_id", "==", issueId)
      .get(),
  ]);
  const batch = db.batch();
  batch.delete(db.collection("issues").doc(issueId));
  votes.docs.forEach((v) => batch.delete(v.ref));
  comments.docs.forEach((c) => batch.delete(c.ref));
  await batch.commit();
  revalidatePath(pathFor(teamId));
}

/**
 * Soft-archive or restore an issue.
 *
 * Restore reopens it. An issue is archived because it was solved or dropped,
 * and `archiveIssuesClosedDuringMeeting` re-archives anything still closed
 * with a `resolved_at` inside the meeting window — so clearing only
 * `archived_at` would let an issue restored mid-L10 vanish again at Finish.
 * Rocks and headlines already learned this: their restores clear
 * `completed_at` / `discussed` for exactly the same reason.
 */
export async function setIssueArchived(
  teamId: string,
  issueId: string,
  archived: boolean,
) {
  const { uid, db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "issues", issueId, teamId);
  await db
    .collection("issues")
    .doc(issueId)
    .update(
      archived
        ? { archived_at: FieldValue.serverTimestamp() }
        : { archived_at: null, status: "open", resolved_at: null },
    );
  // Traced, not told — same as to-dos: archiving is housekeeping on an
  // issue already closed, and restoring is visible on the list.
  await recordActivity({
    db,
    teamId,
    entity: activityEntity(issueId, snap.data() ?? {}),
    kind: archived ? "archived" : "restored",
    actor: { id: uid },
  });
  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
}

/**
 * Archive issues solved/dropped during this L10. Mid-week closes stay on
 * Active (gray) until the Monday worker.
 */
export async function archiveIssuesClosedDuringMeeting(
  teamId: string,
  meetingId: string,
): Promise<number> {
  const { db } = await requireTeamAccess(teamId);
  const meetingSnap = await requireTeamDoc(db, "meetings", meetingId, teamId);
  const m = meetingSnap.data() ?? {};
  const startMs =
    typeof m.started_at?.toMillis === "function"
      ? m.started_at.toMillis()
      : 0;
  const endMs =
    typeof m.ended_at?.toMillis === "function"
      ? m.ended_at.toMillis()
      : Date.now();
  if (!startMs) return 0;

  const snap = await db
    .collection("issues")
    .where("team_id", "==", teamId)
    .get();
  const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ids = new Set(
    selectIssuesClosedDuringMeeting(candidates, startMs, endMs),
  );
  if (ids.size === 0) return 0;

  const batch = db.batch();
  for (const d of snap.docs) {
    if (!ids.has(d.id)) continue;
    batch.update(d.ref, { archived_at: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  revalidatePath(pathFor(teamId));
  return ids.size;
}
