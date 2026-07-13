"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";
import {
  SEGMENTS,
  nextSegment,
  prevSegment,
  type Segment,
} from "@/lib/l10/segments";

function listPath(teamId: string) {
  return `/teams/${teamId}/meetings`;
}
function detailPath(teamId: string, meetingId: string) {
  return `/teams/${teamId}/meetings/${meetingId}`;
}

export async function startMeeting(teamId: string) {
  const { db } = await requireTeamAccess(teamId);
  const ref = db.collection("meetings").doc();
  await ref.set({
    team_id: teamId,
    started_at: FieldValue.serverTimestamp(),
    ended_at: null,
    current_segment: "segue",
    segment_started_at: FieldValue.serverTimestamp(),
    current_issue_id: null,
    notes: null,
  });
  redirect(detailPath(teamId, ref.id));
}

export async function advanceSegment(
  teamId: string,
  meetingId: string,
  direction: "next" | "prev",
) {
  const { db } = await requireTeamAccess(teamId);
  const ref = db.collection("meetings").doc(meetingId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Meeting not found");

  const current = (snap.data()?.current_segment as Segment) ?? "segue";
  const target =
    direction === "next" ? nextSegment(current) : prevSegment(current);

  await ref.update({
    current_segment: target,
    segment_started_at: FieldValue.serverTimestamp(),
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
  await db.collection("meetings").doc(meetingId).update({
    current_segment: target,
    segment_started_at: FieldValue.serverTimestamp(),
  });
  revalidatePath(detailPath(teamId, meetingId));
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
  await db
    .collection("meetings")
    .doc(meetingId)
    .update({ current_issue_id: issueId });
}

export async function endMeeting(teamId: string, meetingId: string) {
  const { db } = await requireTeamAccess(teamId);
  await db.collection("meetings").doc(meetingId).update({
    current_segment: "done",
    ended_at: FieldValue.serverTimestamp(),
  });
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

