"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";
import { nextSegment, prevSegment, type Segment } from "@/lib/l10/segments";

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

export async function endMeeting(teamId: string, meetingId: string) {
  const { db } = await requireTeamAccess(teamId);
  await db.collection("meetings").doc(meetingId).update({
    current_segment: "done",
    ended_at: FieldValue.serverTimestamp(),
  });
  revalidatePath(detailPath(teamId, meetingId));
  revalidatePath(listPath(teamId));
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

export async function rateMeeting(
  teamId: string,
  meetingId: string,
  formData: FormData,
) {
  const { uid, db } = await requireTeamAccess(teamId);
  const score = Number(formData.get("score"));
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    throw new Error("Score must be 1–10");
  }
  await db
    .collection("meetings")
    .doc(meetingId)
    .collection("ratings")
    .doc(uid)
    .set({
      user_id: uid,
      score: Math.round(score),
      created_at: FieldValue.serverTimestamp(),
    });
  revalidatePath(detailPath(teamId, meetingId));
}

export async function deleteMeeting(teamId: string, meetingId: string) {
  const { db } = await requireTeamAccess(teamId);
  const ratings = await db
    .collection("meetings")
    .doc(meetingId)
    .collection("ratings")
    .get();
  const batch = db.batch();
  ratings.docs.forEach((r) => batch.delete(r.ref));
  batch.delete(db.collection("meetings").doc(meetingId));
  await batch.commit();
  revalidatePath(listPath(teamId));
}

