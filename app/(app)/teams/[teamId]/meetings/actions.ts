"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FieldValue } from "firebase-admin/firestore";
import {
  getTeamMembers,
  requireTeamAccess,
  requireTeamDoc,
} from "@/lib/firebase/teams";
import {
  SEGMENTS,
  nextSegment,
  prevSegment,
  type Segment,
} from "@/lib/l10/segments";
import {
  clampSpeakerIndex,
  firstPresentIndex,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";

function listPath(teamId: string) {
  return `/teams/${teamId}/meetings`;
}
function detailPath(teamId: string, meetingId: string) {
  return `/teams/${teamId}/meetings/${meetingId}`;
}

export async function startMeeting(teamId: string) {
  const { db, team } = await requireTeamAccess(teamId);

  // One live meeting per team: if someone already started one, join it
  // instead of minting a duplicate — two people clicking Start at 9:00 (or a
  // double-click on the button) must land everyone in the same room.
  const activeSnap = await db
    .collection("meetings")
    .where("team_id", "==", teamId)
    .where("ended_at", "==", null)
    .limit(1)
    .get();
  if (!activeSnap.empty) {
    redirect(detailPath(teamId, activeSnap.docs[0].id));
  }

  // Take a copy of the team's durable rotation for this meeting. Reconciling
  // here (rather than trusting the stored array) means a meeting always opens
  // with an order that matches today's roster, and a team that has never set
  // one gets the alphabetical roster instead of an empty rail.
  const members = await getTeamMembers(teamId);
  const speakingOrder = reconcileSpeakingOrder(team.speakingOrder, members);

  const ref = db.collection("meetings").doc();
  await ref.set({
    team_id: teamId,
    started_at: FieldValue.serverTimestamp(),
    ended_at: null,
    current_segment: "segue",
    segment_started_at: FieldValue.serverTimestamp(),
    current_issue_id: null,
    notes: null,
    absent_user_ids: [],
    speaking_order: speakingOrder,
    speaking_index: 0,
  });
  redirect(detailPath(teamId, ref.id));
}

export async function advanceSegment(
  teamId: string,
  meetingId: string,
  direction: "next" | "prev",
  // The segment the clicking client believed was active. When two people hit
  // Next in the same second, the second write sees the segment has already
  // moved and no-ops instead of skipping a stage.
  expectedCurrent?: Segment,
) {
  const { db } = await requireTeamAccess(teamId);
  const ref = db.collection("meetings").doc(meetingId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.team_id !== teamId) {
      throw new Error("Meeting not found");
    }
    // A concluded meeting has nothing to drive — a stale tab clicking Next
    // after someone finished must not rewrite history.
    if (snap.data()?.ended_at != null) return;

    const current = (snap.data()?.current_segment as Segment) ?? "segue";
    if (expectedCurrent && current !== expectedCurrent) return;

    const target =
      direction === "next" ? nextSegment(current) : prevSegment(current);
    // "done" is only ever written by endMeeting (the Finish button) — Next on
    // Conclude stops there rather than stranding a live meeting in a state
    // the page has no rendering for.
    if (target === "done" || target === current) return;

    tx.update(ref, {
      current_segment: target,
      segment_started_at: FieldValue.serverTimestamp(),
      // Every stage after Segue is its own round-robin, so a stage change
      // restarts the round at the first person who is actually in the room.
      speaking_index: firstPresentIndex(
        (snap.data()?.speaking_order as string[]) ?? [],
        (snap.data()?.absent_user_ids as string[]) ?? [],
      ),
    });
  });

  revalidatePath(detailPath(teamId, meetingId));
}

export async function jumpToSegment(
  teamId: string,
  meetingId: string,
  target: Segment,
) {
  if (!SEGMENTS.includes(target) || target === "done") {
    throw new Error("Invalid segment");
  }
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "meetings", meetingId, teamId);
  await db
    .collection("meetings")
    .doc(meetingId)
    .update({
      current_segment: target,
      segment_started_at: FieldValue.serverTimestamp(),
      speaking_index: firstPresentIndex(
        (snap.data()?.speaking_order as string[]) ?? [],
        (snap.data()?.absent_user_ids as string[]) ?? [],
      ),
    });
  revalidatePath(detailPath(teamId, meetingId));
}

// Reorder the speaking rotation. Writes BOTH copies: the team doc holds the
// durable order the next meeting will inherit, the meeting doc holds the copy
// every client is actually subscribed to (see lib/l10/speaking-order.ts for
// why the order is duplicated).
//
// No revalidatePath — the meeting-doc snapshot delivers this to every client
// instantly, and a re-render would only add lag (same reasoning as
// setDiscussingIssue below).
export async function setSpeakingOrder(
  teamId: string,
  meetingId: string,
  uids: string[],
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "meetings", meetingId, teamId);

  // Never trust a client-supplied uid list: it becomes the team's durable
  // order, so it must be exactly a permutation of the current roster — no
  // foreign uids, no duplicates, nobody dropped.
  const members = await getTeamMembers(teamId);
  const memberIds = new Set(members.map((m) => m.user_id));
  const unique = new Set(uids);
  const isPermutation =
    uids.length === members.length &&
    unique.size === uids.length &&
    uids.every((uid) => memberIds.has(uid));
  if (!isPermutation) throw new Error("Invalid speaking order");

  const batch = db.batch();
  batch.update(db.collection("teams").doc(teamId), { speaking_order: uids });
  batch.update(db.collection("meetings").doc(meetingId), {
    speaking_order: uids,
  });
  await batch.commit();
}

// Move the live "who's sharing now" pointer. Clamped against the order stored
// on the meeting so a stale client index can't point off the end.
export async function setSpeakingIndex(
  teamId: string,
  meetingId: string,
  index: number,
) {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "meetings", meetingId, teamId);
  let order = (snap.data()?.speaking_order as string[]) ?? [];
  const update: Record<string, unknown> = {};
  if (order.length === 0) {
    // Meetings started before the speaking order shipped (or hand-seeded
    // ones) store no order, and clamping against an empty array pinned the
    // pointer at 0 forever — "Next speaker" looked dead. Backfill the
    // reconciled roster order once, then clamp against it.
    order = reconcileSpeakingOrder(null, await getTeamMembers(teamId));
    update.speaking_order = order;
  }
  update.speaking_index = clampSpeakerIndex(index, order.length);
  await db.collection("meetings").doc(meetingId).update(update);
}

// Mark which issue the group is currently discussing (or null to clear).
// No revalidatePath: every client subscribes to the meeting doc live, so the
// snapshot delivers this instantly — a re-render would only add lag.
export async function setDiscussingIssue(
  teamId: string,
  meetingId: string,
  issueId: string | null,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "meetings", meetingId, teamId);
  await db
    .collection("meetings")
    .doc(meetingId)
    .update({ current_issue_id: issueId });
}

export async function endMeeting(teamId: string, meetingId: string) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "meetings", meetingId, teamId);
  // Transactional so a second Finish (two people, or a stale tab) can't
  // overwrite ended_at and inflate the recorded duration.
  const ref = db.collection("meetings").doc(meetingId);
  const didEnd = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.data()?.ended_at != null) return false;
    tx.update(ref, {
      current_segment: "done",
      ended_at: FieldValue.serverTimestamp(),
    });
    return true;
  });

  // EOS vote credits rank THIS meeting's IDS hour — they reset when the
  // meeting ends. Without this, the whole team opened the next L10 already
  // "out of votes" (credits were effectively lifetime-per-team). Best-effort
  // cleanup after the conclude write; issue docs keep their solved/dropped
  // status, only the vote tallies reset.
  if (didEnd) {
    const [voteRows, issueRows] = await Promise.all([
      db.collection("issue_votes").where("team_id", "==", teamId).get(),
      db.collection("issues").where("team_id", "==", teamId).get(),
    ]);
    const batch = db.batch();
    voteRows.docs.forEach((d) => batch.delete(d.ref));
    issueRows.docs.forEach((d) => {
      if ((d.data().votes ?? 0) !== 0) batch.update(d.ref, { votes: 0 });
    });
    await batch.commit();
  }
  revalidatePath(detailPath(teamId, meetingId));
  revalidatePath(listPath(teamId));
  // ?recap=1 opens the post-meeting recap modal on the next render.
  redirect(`${detailPath(teamId, meetingId)}?recap=1`);
}

export async function saveMeetingNotes(
  teamId: string,
  meetingId: string,
  formData: FormData,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "meetings", meetingId, teamId);
  const notes = String(formData.get("notes") ?? "");
  await db.collection("meetings").doc(meetingId).update({ notes });
  revalidatePath(detailPath(teamId, meetingId));
}

// End-of-meeting rating (EOS-style meeting effectiveness vote). Each
// attendee rates the MEETING itself 1–10, with an optional note explaining
// the rating — not a peer rating of other attendees. Doc id is the rater's
// own uid, so re-saving overwrites that attendee's prior rating.
export async function rateMeeting(
  teamId: string,
  meetingId: string,
  formData: FormData,
) {
  const { uid, db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "meetings", meetingId, teamId);
  const rating = Number(formData.get("rating"));
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
    throw new Error("Rating must be 1–10");
  }
  const notes = String(formData.get("notes") ?? "").trim() || null;
  await db
    .collection("meetings")
    .doc(meetingId)
    .collection("effectiveness_scores")
    .doc(uid)
    .set({
      user_id: uid,
      rating: Math.round(rating),
      notes,
      created_at: FieldValue.serverTimestamp(),
    });
  revalidatePath(detailPath(teamId, meetingId));
}

// Absence is a meeting-level fact, not per-rater. We store the list of absent
// user IDs on the meeting doc and union/remove on toggle.
export async function setAttendeeAbsence(
  teamId: string,
  meetingId: string,
  userId: string,
  absent: boolean,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "meetings", meetingId, teamId);
  const ref = db.collection("meetings").doc(meetingId);
  await ref.update({
    absent_user_ids: absent
      ? FieldValue.arrayUnion(userId)
      : FieldValue.arrayRemove(userId),
  });
  revalidatePath(detailPath(teamId, meetingId));
}

export async function deleteMeeting(teamId: string, meetingId: string) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "meetings", meetingId, teamId);
  const scores = await db
    .collection("meetings")
    .doc(meetingId)
    .collection("effectiveness_scores")
    .get();
  const batch = db.batch();
  scores.docs.forEach((r) => batch.delete(r.ref));
  batch.delete(db.collection("meetings").doc(meetingId));
  await batch.commit();
  revalidatePath(listPath(teamId));
}

