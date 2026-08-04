"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";

const KINDS = ["customer", "employee", "cascading"] as const;
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

export async function deleteHeadline(teamId: string, headlineId: string) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "headlines", headlineId, teamId);
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
 * Archive every active headline that has been marked discussed.
 * Does NOT touch undiscussed (standing) headlines — open positions, etc.
 * Called from endMeeting and available as a manual bulk action.
 */
export async function archiveDiscussedHeadlines(teamId: string): Promise<number> {
  const { db } = await requireTeamAccess(teamId);
  const snap = await db
    .collection("headlines")
    .where("team_id", "==", teamId)
    .get();

  const toArchive = snap.docs.filter((d) => {
    const x = d.data();
    if (x.archived_at != null) return false;
    if (x.broadcast) return false; // org-wide read-only copies
    return x.discussed === true;
  });

  if (toArchive.length === 0) return 0;

  // Firestore batches cap at 500; teams will never approach that for headlines.
  const batch = db.batch();
  for (const d of toArchive) {
    batch.update(d.ref, { archived_at: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  revalidateHeadlines(teamId);
  return toArchive.length;
}
