"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";
import { selectHeadlinesDiscussedDuringMeeting } from "@/lib/todos-archive";

const KINDS = ["customer", "employee", "cascading", "general"] as const;
type Kind = (typeof KINDS)[number];

function pathFor(teamId: string) {
  return `/teams/${teamId}/headlines`;
}

function revalidateHeadlines(teamId: string) {
  revalidatePath(pathFor(teamId));
  // L10 segment reads the same collection; revalidate team meeting roots.
  revalidatePath(`/teams/${teamId}/meetings`);
}

export async function addHeadline(teamId: string, formData: FormData) {
  const { uid, db } = await requireTeamAccess(teamId);

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim() || null;
  const kindRaw = String(formData.get("kind") ?? "customer");
  const kind: Kind = KINDS.includes(kindRaw as Kind)
    ? (kindRaw as Kind)
    : "customer";

  if (!title) throw new Error("Title required");

  await db.collection("headlines").add({
    team_id: teamId,
    title,
    body,
    kind,
    created_by: uid,
    target_team_ids: [],
    // Meeting hygiene (P2-3): discuss in L10, then archive only checked-off.
    discussed: false,
    discussed_at: null,
    archived_at: null,
    created_at: FieldValue.serverTimestamp(),
  });

  revalidateHeadlines(teamId);
}

/**
 * Edit a headline's title / detail / category. Any team member with access
 * can edit (same convention as updateTodoMeta / updateIssueMeta — no
 * owner-only restriction). Org-wide broadcast copies stay read-only, same
 * guard as delete/discuss/archive.
 */
export async function updateHeadline(
  teamId: string,
  headlineId: string,
  formData: FormData,
) {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "headlines", headlineId, teamId);
  if (snap.data()?.broadcast) {
    throw new Error("Org-wide headlines are read-only");
  }

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim() || null;
  const kindRaw = String(formData.get("kind") ?? "customer");
  const kind: Kind = KINDS.includes(kindRaw as Kind)
    ? (kindRaw as Kind)
    : "customer";

  if (!title) throw new Error("Title required");

  await db.collection("headlines").doc(headlineId).update({
    title,
    body,
    kind,
  });

  revalidateHeadlines(teamId);
}

export async function deleteHeadline(teamId: string, headlineId: string) {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "headlines", headlineId, teamId);
  if (snap.data()?.broadcast) {
    throw new Error("Org-wide headlines are read-only");
  }
  await db.collection("headlines").doc(headlineId).delete();
  revalidateHeadlines(teamId);
}

/** Mark (or clear) a headline as discussed in the meeting. */
export async function setHeadlineDiscussed(
  teamId: string,
  headlineId: string,
  discussed: boolean,
) {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "headlines", headlineId, teamId);
  if (snap.data()?.broadcast) {
    throw new Error("Org-wide headlines are read-only");
  }
  await db
    .collection("headlines")
    .doc(headlineId)
    .update({
      discussed,
      discussed_at: discussed ? FieldValue.serverTimestamp() : null,
    });
  revalidateHeadlines(teamId);
}

/** Soft-archive or restore a single headline. Standing items stay unarchived. */
export async function setHeadlineArchived(
  teamId: string,
  headlineId: string,
  archived: boolean,
) {
  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "headlines", headlineId, teamId);
  if (snap.data()?.broadcast) {
    throw new Error("Org-wide headlines are read-only");
  }
  // Restore clears discuss so standing items don't re-archive on next Finish.
  await db
    .collection("headlines")
    .doc(headlineId)
    .update(
      archived
        ? { archived_at: FieldValue.serverTimestamp() }
        : {
            archived_at: null,
            discussed: false,
            discussed_at: null,
          },
    );
  revalidateHeadlines(teamId);
}

/**
 * Archive headlines discussed *during this L10* only. Standing (undiscussed)
 * never auto-archive. Mid-week discuss stays gray on Active until Monday.
 */
export async function archiveHeadlinesDiscussedDuringMeeting(
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
    .collection("headlines")
    .where("team_id", "==", teamId)
    .get();
  const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ids = new Set(
    selectHeadlinesDiscussedDuringMeeting(candidates, startMs, endMs),
  );
  if (ids.size === 0) return 0;

  const batch = db.batch();
  for (const d of snap.docs) {
    if (!ids.has(d.id)) continue;
    batch.update(d.ref, { archived_at: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  revalidateHeadlines(teamId);
  return ids.size;
}

/** @deprecated Prefer archiveHeadlinesDiscussedDuringMeeting (windowed). */
export async function archiveDiscussedHeadlines(
  teamId: string,
  meetingId?: string,
): Promise<number> {
  if (!meetingId) return 0;
  return archiveHeadlinesDiscussedDuringMeeting(teamId, meetingId);
}
