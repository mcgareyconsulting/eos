"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";
import { isRockStatus } from "./status";
import { isRockType } from "./rock-type";

function pathFor(teamId: string) {
  return `/teams/${teamId}/rocks`;
}

export async function setRockType(
  teamId: string,
  rockId: string,
  rockType: string,
) {
  if (!isRockType(rockType)) throw new Error("Bad rock type");

  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "rocks", rockId, teamId);
  await db.collection("rocks").doc(rockId).update({ rock_type: rockType });

  revalidatePath(pathFor(teamId));
}

// Atomic: writes the new status onto the rock AND appends an immutable history
// entry to rock_status_updates. Off-track always requires a "why" comment.
// Done stamps completed_at (Monday archive sweep clock); leaving Done clears it.
export async function setRockStatus(
  teamId: string,
  rockId: string,
  status: string,
  comment: string | null,
) {
  if (!isRockStatus(status)) throw new Error("Bad status");
  const trimmed = (comment ?? "").trim() || null;
  if (status === "off_track" && !trimmed) {
    throw new Error("Comment required when moving a rock off track.");
  }

  const { uid, db } = await requireTeamAccess(teamId);
  const rockSnap = await requireTeamDoc(db, "rocks", rockId, teamId);
  const prevStatus = String(rockSnap.data()?.status ?? "");

  // Monday worker archives status=done with completed_at before this week's
  // Monday 00:00. Stamp completed_at only on the transition into Done (don't
  // reset the clock if they re-save Done). Leaving Done clears it.
  const rockPatch: Record<string, unknown> = { status };
  if (status === "done") {
    if (prevStatus !== "done") {
      rockPatch.completed_at = FieldValue.serverTimestamp();
    }
  } else {
    rockPatch.completed_at = null;
  }

  const batch = db.batch();
  batch.update(db.collection("rocks").doc(rockId), rockPatch);
  batch.set(db.collection("rock_status_updates").doc(), {
    rock_id: rockId,
    team_id: teamId,
    status,
    comment: trimmed,
    user_id: uid,
    created_at: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  revalidatePath(pathFor(teamId));
  // Live L10 rocks segment also shows StatusPopover; keep RSC payloads fresh
  // for anyone who lands mid-meeting without a client subscription yet.
  revalidatePath(`/teams/${teamId}/meetings`);
  revalidatePath("/home");
}

// Manual archive control (Gmail-style icon on the row) — mirrors
// headlines' setHeadlineArchived. Reversible, so callers don't confirm.
// Restore also clears completed_at: a still-Done rock keeps its
// completed_at from before archiving, and the Monday sweep
// (isActiveDoneRock in lib/todos-archive.ts) would otherwise re-archive it
// the moment archived_at goes null again. Re-saving Done re-stamps it.
export async function setRockArchived(
  teamId: string,
  rockId: string,
  archived: boolean,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "rocks", rockId, teamId);
  await db
    .collection("rocks")
    .doc(rockId)
    .update(
      archived
        ? { archived_at: FieldValue.serverTimestamp() }
        : { archived_at: null, completed_at: null },
    );

  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/meetings`);
  revalidatePath("/home");
}

// Removes the rock, linked milestones (todos), and entity_comments.
// Single batch so a partial failure can't orphan children.
export async function deleteRock(teamId: string, rockId: string) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "rocks", rockId, teamId);

  const [milestonesSnap, commentsSnap] = await Promise.all([
    db
      .collection("todos")
      .where("team_id", "==", teamId)
      .where("source_rock_id", "==", rockId)
      .get(),
    db
      .collection("entity_comments")
      .where("team_id", "==", teamId)
      .where("entity_type", "==", "rock")
      .where("entity_id", "==", rockId)
      .get(),
  ]);

  const batch = db.batch();
  milestonesSnap.docs.forEach((d) => batch.delete(d.ref));
  commentsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(db.collection("rocks").doc(rockId));
  await batch.commit();

  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath("/home");
}

// The redesigned modal (rock-modal.tsx) saves a rock and its milestones in one
// step, so both of these take a `milestones` field: a JSON array of
// { id?, title, owner_id, due_date }. `id` present = existing todo doc to
// update; absent = create. Anything missing from the array on an edit is
// deleted. One batch, so the list can never show a rock whose milestones
// silently failed to write.

type MilestoneInput = {
  id?: string;
  title: string;
  owner_id: string;
  due_date: string | null;
};

function parseMilestones(raw: FormDataEntryValue | null): MilestoneInput[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Malformed milestones payload");
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((m) => {
      const x = m as Record<string, unknown>;
      const title = String(x.title ?? "").trim();
      const owner_id = String(x.owner_id ?? "").trim();
      const dueRaw = String(x.due_date ?? "").trim();
      const id = typeof x.id === "string" && x.id ? x.id : undefined;
      return { id, title, owner_id, due_date: dueRaw || null };
    })
    .filter((m) => m.title.length > 0);
}

function milestoneDoc(
  teamId: string,
  rockId: string,
  m: MilestoneInput,
  fallbackOwner: string,
) {
  return {
    team_id: teamId,
    title: m.title,
    owner_id: m.owner_id || fallbackOwner,
    due_date: m.due_date,
    description: null,
    completed_at: null,
    archived_at: null,
    visibility: "team" as const,
    source_issue_id: null,
    source_meeting_id: null,
    source_rock_id: rockId,
    created_at: FieldValue.serverTimestamp(),
  };
}

// Owner is always a person; type (individual / team) is a separate field.
function parseRockFields(formData: FormData, uid: string) {
  const title = String(formData.get("title") ?? "").trim();
  // Free-text quarter (e.g. "2026-Q3" or "H2 2026") — not locked to calendar Q.
  const quarter = String(formData.get("quarter") ?? "").trim();
  if (!title || !quarter) throw new Error("Title and quarter required");

  const ownerRaw = String(formData.get("owner_id") ?? "").trim();
  // Reject legacy "team" / Department sentinel — team rocks still need a person.
  if (!ownerRaw || ownerRaw === "team") {
    throw new Error(
      "Owner is required — pick a person accountable for this rock.",
    );
  }

  const rockTypeRaw = String(formData.get("rock_type") ?? "").trim();
  const rock_type = isRockType(rockTypeRaw) ? rockTypeRaw : "individual";

  return {
    title,
    quarter,
    // P2-6: due is optional and stays null when cleared. The modal prefills
    // end-of-quarter as a suggestion; it must never be re-forced here.
    due_date: String(formData.get("due_date") ?? "").trim() || null,
    description: String(formData.get("description") ?? "").trim() || null,
    owner_id: ownerRaw || uid,
    rock_type,
  };
}

export async function createRockWithMilestones(
  teamId: string,
  formData: FormData,
) {
  const { uid, db } = await requireTeamAccess(teamId);

  const { title, quarter, due_date, description, owner_id, rock_type } =
    parseRockFields(formData, uid);

  const milestones = parseMilestones(formData.get("milestones"));

  const rockRef = db.collection("rocks").doc();
  const batch = db.batch();
  batch.set(rockRef, {
    team_id: teamId,
    title,
    quarter,
    due_date,
    owner_id,
    description,
    rock_type,
    status: "on_track",
    completed_at: null,
    // Explicit null so the Monday sweep's `archived_at == null` equality
    // filter matches (Firestore never matches a missing field).
    archived_at: null,
    created_at: FieldValue.serverTimestamp(),
  });
  for (const m of milestones) {
    batch.set(
      db.collection("todos").doc(),
      milestoneDoc(teamId, rockRef.id, m, owner_id),
    );
  }
  await batch.commit();

  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath("/home");
}

export async function updateRockWithMilestones(
  teamId: string,
  rockId: string,
  formData: FormData,
) {
  const { uid, db } = await requireTeamAccess(teamId);

  const { title, quarter, due_date, description, owner_id, rock_type } =
    parseRockFields(formData, uid);

  const milestones = parseMilestones(formData.get("milestones"));
  const keptIds = new Set(
    milestones.map((m) => m.id).filter((id): id is string => !!id),
  );

  // The ownership check and the milestone read are independent — one round
  // trip, not two.
  const [, existingSnap] = await Promise.all([
    requireTeamDoc(db, "rocks", rockId, teamId),
    db
      .collection("todos")
      .where("team_id", "==", teamId)
      .where("source_rock_id", "==", rockId)
      .get(),
  ]);

  const batch = db.batch();
  batch.update(db.collection("rocks").doc(rockId), {
    title,
    quarter,
    due_date,
    description,
    owner_id,
    rock_type,
  });

  // Rows the user removed in the modal.
  for (const d of existingSnap.docs) {
    if (!keptIds.has(d.id)) batch.delete(d.ref);
  }

  const existingIds = new Set(existingSnap.docs.map((d) => d.id));
  const fallbackOwner = owner_id;
  for (const m of milestones) {
    if (m.id && existingIds.has(m.id)) {
      batch.update(db.collection("todos").doc(m.id), {
        title: m.title,
        owner_id: m.owner_id || fallbackOwner,
        due_date: m.due_date,
      });
    } else {
      batch.set(
        db.collection("todos").doc(),
        milestoneDoc(teamId, rockId, m, fallbackOwner),
      );
    }
  }
  await batch.commit();

  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath("/home");
}
