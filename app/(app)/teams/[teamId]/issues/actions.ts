"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";

const STATUSES = ["open", "solving", "solved", "dropped"] as const;
type Status = (typeof STATUSES)[number];

const TYPES = ["short", "long"] as const;
type Type = (typeof TYPES)[number];

const MAX_VOTES_PER_TEAM = 3;

function pathFor(teamId: string) {
  return `/teams/${teamId}/issues`;
}

export async function addIssue(teamId: string, formData: FormData) {
  const { uid, db } = await requireTeamAccess(teamId);

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const typeRaw = String(formData.get("type") ?? "short");
  const type: Type = TYPES.includes(typeRaw as Type)
    ? (typeRaw as Type)
    : "short";

  if (!title) throw new Error("Title required");

  await db.collection("issues").add({
    team_id: teamId,
    title,
    description,
    owner_id: uid,
    votes: 0,
    type,
    status: "open",
    resolved_at: null,
    resolution_todo_id: null,
    created_at: FieldValue.serverTimestamp(),
  });

  revalidatePath(pathFor(teamId));
}

// Cast a vote on this issue (delta = +1 or -1). Each user has 3 vote credits
// per team and can stack multiple credits on a single issue. Atomic across:
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

    // Reads first (Firestore transaction rule).
    const voteSnap = await tx.get(voteRef);
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
          `Out of votes (${MAX_VOTES_PER_TEAM} per team). Remove one first.`,
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
  const { db } = await requireTeamAccess(teamId);
  const update: Record<string, unknown> = { status };
  if (status === "solved" || status === "dropped") {
    update.resolved_at = FieldValue.serverTimestamp();
  }
  await db.collection("issues").doc(issueId).update(update);
  revalidatePath(pathFor(teamId));
}

export async function deleteIssue(teamId: string, issueId: string) {
  const { db } = await requireTeamAccess(teamId);
  // Cascade: delete the issue + any votes for it
  const votes = await db
    .collection("issue_votes")
    .where("issue_id", "==", issueId)
    .get();
  const batch = db.batch();
  batch.delete(db.collection("issues").doc(issueId));
  votes.docs.forEach((v) => batch.delete(v.ref));
  await batch.commit();
  revalidatePath(pathFor(teamId));
}
