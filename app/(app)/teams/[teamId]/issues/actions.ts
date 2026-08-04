"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";
import { MAX_VOTES_PER_TEAM } from "@/lib/issues";
import { selectIssuesClosedDuringMeeting } from "@/lib/todos-archive";

const STATUSES = ["open", "solving", "solved", "dropped"] as const;
type Status = (typeof STATUSES)[number];

const TYPES = ["short", "long"] as const;
type Type = (typeof TYPES)[number];

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
type Priority = (typeof PRIORITIES)[number];

function pathFor(teamId: string) {
  return `/teams/${teamId}/issues`;
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

export async function addIssue(teamId: string, formData: FormData) {
  const { uid, db } = await requireTeamAccess(teamId);

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

  await db.collection("issues").add({
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
    created_at: FieldValue.serverTimestamp(),
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
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "issues", issueId, teamId);

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title required");

  const typeRaw = String(formData.get("type") ?? "short");
  const type: Type = TYPES.includes(typeRaw as Type)
    ? (typeRaw as Type)
    : "short";
  const owner_id = readOwnerId(formData, null);
  const priority = readPriority(formData);
  const description = String(formData.get("description") ?? "").trim() || null;

  await db.collection("issues").doc(issueId).update({
    title,
    type,
    owner_id,
    priority,
    description,
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
    // so we can verify it belongs to this team before voting on it.
    const [voteSnap, issueSnap] = await Promise.all([
      tx.get(voteRef),
      tx.get(issueRef),
    ]);
    if (!issueSnap.exists || issueSnap.data()?.team_id !== teamId) {
      throw new Error("Issue not found");
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
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "issues", issueId, teamId);
  const update: Record<string, unknown> = { status };
  if (status === "solved" || status === "dropped") {
    update.resolved_at = FieldValue.serverTimestamp();
  } else {
    // Re-open clears close timestamp so it won't archive as "closed this week".
    update.resolved_at = null;
  }
  await db.collection("issues").doc(issueId).update(update);
  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
}

/** Move an issue between short-term and long-term parking lot. */
export async function setIssueType(
  teamId: string,
  issueId: string,
  type: string,
) {
  if (!TYPES.includes(type as Type)) throw new Error("Bad type");
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "issues", issueId, teamId);
  await db.collection("issues").doc(issueId).update({ type });

  // Long-term issues aren't the IDS/discuss target — clear any live meeting
  // pin so "Discussing" doesn't stick after the issue leaves short-term.
  if (type === "long") {
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

  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
}

export async function deleteIssue(teamId: string, issueId: string) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "issues", issueId, teamId);
  // Cascade: issue + votes + comments (P2-5 entity_comments)
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

/** Soft-archive or restore an issue. */
export async function setIssueArchived(
  teamId: string,
  issueId: string,
  archived: boolean,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "issues", issueId, teamId);
  await db
    .collection("issues")
    .doc(issueId)
    .update({
      archived_at: archived ? FieldValue.serverTimestamp() : null,
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
