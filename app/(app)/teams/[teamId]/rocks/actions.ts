"use server";

import { revalidatePath } from "next/cache";
import { LONG_TEXT_MAX, TITLE_MAX, requireMaxLength } from "@/lib/text-limits";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { notFound } from "next/navigation";
import {
  getTeamMembers,
  requireRosterOwner,
  requireTeamAccess,
} from "@/lib/firebase/teams";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { requireViewer } from "@/lib/firebase/viewer";
import {
  audienceTeamIdsOf,
  audienceUserIdsOf,
  isPrivateRock,
  rockAccess,
  rockSubjectOf,
  type RockSubject,
} from "@/lib/access/rock";
import type { Viewer } from "@/lib/access/types";
import { chunkForInQuery } from "@/lib/firestore-in";
import { emitEvent } from "@/lib/firebase/notifications";
import { purgeItem } from "@/lib/firebase/purge";
import { emitAudienceAdded } from "@/lib/firebase/rock-events";
import { deleteTaskForTodo } from "@/lib/google/tasks";
import { assignmentPatch } from "@/lib/follow";
import type { RockEvent } from "@/lib/item-registry";
import {
  audienceAdded,
  reassignmentRecipients,
  rockEditEvents,
} from "@/lib/rock-notify";
import { isCompanyRock } from "@/lib/rock-bucket";
import { loadUsersById } from "@/lib/firebase/queries";
import { userDisplayName } from "@/lib/user-name";
import { isRockStatus } from "./status";
import { isRockType } from "./rock-type";

// Every rock action names the rock's PARENT team as `teamId` (rows render
// rock actions against the rock's own team wherever it shows) and is gated
// by lib/access/rock.ts with the caller's full memberships — not by the
// caller being on `teamId`, because the audience edits from its own team's
// page. The Admin SDK bypasses firestore.rules, so these gates are the real
// ones.

/**
 * Load the rock `rockId` on parent team `teamId` and require `can` for the
 * signed-in viewer. 404 otherwise, so rock ids are not enumerable.
 */
async function requireRock(
  teamId: string,
  rockId: string,
  can: (rock: RockSubject, viewer: Viewer) => boolean,
) {
  const { uid, isAdmin, db, viewer } = await requireViewer();
  const snap = await db.collection("rocks").doc(rockId).get();
  if (!snap.exists) notFound();
  const data = snap.data() ?? {};
  const rock = rockSubjectOf(data);
  if (rock.team_id !== teamId) notFound();
  if (!can(rock, viewer)) notFound();
  return { uid, isAdmin, db, viewer, snap, data, rock };
}

export async function setRockType(
  teamId: string,
  rockId: string,
  rockType: string,
) {
  if (!isRockType(rockType) || rockType === "company") {
    throw new Error("Bad rock type");
  }
  const { db, rock } = await requireRock(teamId, rockId, rockAccess.canEdit);
  await db.collection("rocks").doc(rockId).update({ rock_type: rockType });
  revalidateRockSurfaces(teamId, audienceTeamIdsOf(rock));
}

// Atomic: writes the new status onto the rock AND appends an immutable history
// entry to rock_status_updates. Off-track always requires a "why" comment.
// Done stamps completed_at (Monday archive sweep clock); leaving Done clears it.
// The parent team, the audience and admins may move it (rockAccess).
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

  const { uid, db, data, rock } = await requireRock(
    teamId,
    rockId,
    rockAccess.canSetStatus,
  );
  const prevStatus = String(data.status ?? "");

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
    // Always the parent team: the Rocks tab and L10 read history with
    // `where team_id == <this team>`, and the audience reads it by rock id.
    team_id: teamId,
    status,
    comment: trimmed,
    user_id: uid,
    created_at: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  if (prevStatus !== status) {
    await emitEvent(db, { type: "rock", id: rockId }, "status_changed", uid, {
      teamId,
    });
  }
  revalidateRockSurfaces(teamId, audienceTeamIdsOf(rock));
}

// Manual archive control (Gmail-style icon on the row) — mirrors
// headlines' setHeadlineArchived. Reversible, so callers don't confirm.
// Restore also clears completed_at: a still-Done rock keeps its
// completed_at from before archiving, and the Monday sweep
// (isActiveDoneRock in lib/todos-archive.ts) would otherwise re-archive it
// the moment archived_at goes null again. Re-saving Done re-stamps it.
// Takes the rock off every list, so it stays with the parent team and
// admins, like delete.
export async function setRockArchived(
  teamId: string,
  rockId: string,
  archived: boolean,
) {
  const { db, rock } = await requireRock(teamId, rockId, rockAccess.canDelete);
  await db
    .collection("rocks")
    .doc(rockId)
    .update(
      archived
        ? { archived_at: FieldValue.serverTimestamp() }
        : { archived_at: null, completed_at: null },
    );

  revalidateRockSurfaces(teamId, audienceTeamIdsOf(rock));
}

// Removes the rock, linked milestones (todos), and entity_comments.
// Single batch so a partial failure can't orphan children. Parent team and
// admins only — the audience may edit, not delete.
/** Purge + unmirror milestone docs that were just deleted. Never throws. */
async function purgeRemovedMilestones(
  db: Firestore,
  docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
) {
  for (const d of docs) {
    const x = d.data();
    try {
      await purgeItem(db, { type: "milestone", id: d.id });
    } catch (e) {
      console.error(`[rocks] purge of milestone ${d.id} failed:`, e);
    }
    const owner = typeof x.owner_id === "string" ? x.owner_id : "";
    await deleteTaskForTodo(owner, x.google_task_id as string | null | undefined);
  }
}

export async function deleteRock(teamId: string, rockId: string) {
  const { db, rock } = await requireRock(teamId, rockId, rockAccess.canDelete);

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

  // Spec §5.1: threads, notifications and activity go with each item, and a
  // mirrored Google Task must not keep the milestone's title around.
  await purgeItem(db, { type: "rock", id: rockId });
  await purgeRemovedMilestones(db, milestonesSnap.docs);

  revalidateRockSurfaces(teamId, audienceTeamIdsOf(rock));
}

// The modal (rock-modal.tsx) saves a rock and its milestones in one step,
// so both of these take a `milestones` field: a JSON array of
// { id?, title, owner_id, due_date }. `id` present = existing todo doc to
// update; absent = create. On an edit, a milestone the modal was *shown*
// (`known_milestone_ids`) and that is missing from the array is deleted.
// One batch, so the list can never show a rock whose milestones silently
// failed to write.

type MilestoneInput = {
  id?: string;
  title: string;
  /** "" = no pick: the rock owner, unless the stored doc is unassigned
   *  and this save leaves it untouched (spec §2.6). */
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
      requireMaxLength(title, TITLE_MAX, "Milestone title");
      const owner_id = String(x.owner_id ?? "").trim();
      const dueRaw = String(x.due_date ?? "").trim();
      const id = typeof x.id === "string" && x.id ? x.id : undefined;
      return { id, title, owner_id, due_date: dueRaw || null };
    })
    .filter((m) => m.title.length > 0);
}

/**
 * The assignee a milestone is saved with. Every milestone has one, the rock
 * owner by default (spec §3.3). The only unassigned milestone is one an
 * admin's deactivation left without an owner (§2.6), and only while this
 * save does not touch it — a new or changed milestone always gets one.
 */
function milestoneOwnerFor(
  m: MilestoneInput,
  rockOwner: string,
  stored: { owner_id?: unknown; title?: unknown; due_date?: unknown } | null,
): string | null {
  if (m.owner_id) return m.owner_id;
  if (
    stored &&
    (stored.owner_id == null || stored.owner_id === "") &&
    stored.title === m.title &&
    (stored.due_date ?? null) === m.due_date
  ) {
    return null;
  }
  return rockOwner;
}

function milestoneDoc(
  teamId: string,
  rockId: string,
  m: MilestoneInput,
  ownerId: string,
  assignedBy: { assigned_by: string | null; follower_ids: string[] },
) {
  return {
    ...assignedBy,
    team_id: teamId,
    title: m.title,
    owner_id: ownerId,
    due_date: m.due_date,
    description: null,
    completed_at: null,
    archived_at: null,
    // A milestone is always team-visible as a to-do; its reach is the
    // rock's (lib/access/rock.ts), never the to-do "private" setting.
    visibility: "team" as const,
    source_issue_id: null,
    source_meeting_id: null,
    source_rock_id: rockId,
    created_at: FieldValue.serverTimestamp(),
  };
}

/**
 * Rock fields from the modal. Owner is always a person on the parent team
 * (spec §3.3) — `keepOwner` is the stored owner, who survives an edit even
 * after leaving the team. Kind is separate (individual / department). The
 * Company flag and the audience are NOT parsed here — both are gated by role
 * and preserved for everyone else (companyFlagPatch, audiencePatch).
 */
async function parseRockFields(
  formData: FormData,
  teamId: string,
  keepOwner: string | null,
) {
  const title = String(formData.get("title") ?? "").trim();
  // Free-text quarter (e.g. "2026-Q3" or "H2 2026") — not locked to calendar Q.
  const quarter = String(formData.get("quarter") ?? "").trim();
  if (!title || !quarter) throw new Error("Title and quarter required");
  requireMaxLength(title, TITLE_MAX, "Title");
  requireMaxLength(quarter, TITLE_MAX, "Quarter");
  const description = String(formData.get("description") ?? "").trim() || null;
  requireMaxLength(description, LONG_TEXT_MAX, "Description");

  const ownerRaw = String(formData.get("owner_id") ?? "").trim();
  // Reject legacy "team" / Department sentinel — team rocks still need a person.
  if (!ownerRaw || ownerRaw === "team") {
    throw new Error(
      "Owner is required — pick a person accountable for this rock.",
    );
  }
  await requireRosterOwner(teamId, ownerRaw, { keep: keepOwner });

  const rockTypeRaw = String(formData.get("rock_type") ?? "").trim();
  // The form only offers individual / department. "company" is legacy-only
  // and never written back; a stray value falls to individual.
  const rock_type =
    isRockType(rockTypeRaw) && rockTypeRaw !== "company"
      ? rockTypeRaw
      : "individual";

  return {
    title,
    quarter,
    // Due is optional and stays null when cleared. The modal prefills
    // end-of-quarter as a suggestion; it must never be re-forced here.
    due_date: String(formData.get("due_date") ?? "").trim() || null,
    description,
    owner_id: ownerRaw,
    rock_type,
  };
}

/**
 * The `is_company_rock` value to write. Admin-only to set, org-wide (the
 * claim, not team role — an admin flags a Company rock through whatever team
 * they are on).
 *
 * A non-admin save must **preserve** the stored flag, never default it: the
 * modal always submits the kind radio, so a member re-saving a title change
 * on a Company rock would otherwise wipe the admin's flag. `existing` is the
 * doc being updated (null on create). A legacy `rock_type: "company"` doc is
 * NOT Company (lib/rock-bucket.ts) — the radio rewrites it to department on
 * save and the flag stays false until an admin sets it.
 */
function companyFlagPatch(
  formData: FormData,
  isAdmin: boolean,
  existing: Record<string, unknown> | null,
): boolean {
  if (isAdmin) return formData.get("is_company_rock") === "true";
  return existing ? isCompanyRock(existing as { rock_type?: string | null; is_company_rock?: boolean | null }) : false;
}

function jsonIds(formData: FormData, key: string): string[] {
  const raw = formData.get(key);
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Malformed audience payload");
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.map((x) => String(x ?? "").trim()).filter(Boolean))];
}

/**
 * The audience and Private values to write.
 *
 * Only a leader of the parent team or an admin may change them
 * (rockAccess.canChangeAudience / canSetPrivate). Everyone else's save
 * **preserves** the stored values — like companyFlagPatch, so a member's
 * title edit can never wipe a leader's audience. `stored` is the doc being
 * updated (null on create: no audience, not private). Stored legacy fields
 * come back under the new names, which is how a save migrates a rock.
 *
 * Private clears the audience rather than refusing the save (spec §3.3).
 * No cap: the rules read the lists with hasAny (docs/rules-notes/P6a.md).
 */
async function audiencePatch(
  db: Firestore,
  formData: FormData,
  teamId: string,
  viewer: Viewer,
  stored: RockSubject | null,
): Promise<{
  audience_team_ids: string[];
  audience_user_ids: string[];
  private: boolean;
}> {
  const subject: RockSubject = stored ?? { team_id: teamId, owner_id: null };
  if (!rockAccess.canChangeAudience(subject, viewer)) {
    return {
      audience_team_ids: stored ? audienceTeamIdsOf(stored) : [],
      audience_user_ids: stored ? audienceUserIdsOf(stored) : [],
      private: stored ? isPrivateRock(stored) : false,
    };
  }
  if (formData.get("private") === "true") {
    return { audience_team_ids: [], audience_user_ids: [], private: true };
  }

  const teamIds = jsonIds(formData, "audience_team_ids").filter(
    (id) => id !== teamId,
  );
  if (teamIds.length > 0) {
    const snaps = await db.getAll(
      ...teamIds.map((id) => db.collection("teams").doc(id)),
    );
    if (snaps.some((s) => !s.exists)) {
      throw new Error("Unknown team — pick from the directory list.");
    }
  }

  // A person in the audience must be on some team (the directory).
  const userIds = jsonIds(formData, "audience_user_ids");
  const rostered = new Set<string>();
  for (const ids of chunkForInQuery(userIds)) {
    const snap = await db
      .collection("team_members")
      .where("user_id", "in", ids)
      .get();
    for (const d of snap.docs) rostered.add(d.data().user_id as string);
  }
  if (userIds.some((id) => !rostered.has(id))) {
    throw new Error("Unknown person — pick from the directory list.");
  }

  return { audience_team_ids: teamIds, audience_user_ids: userIds, private: false };
}

/**
 * A milestone assignee must be a person on some team in the org (the
 * picker's "Whole org" scope). Anyone on the parent team passes without a
 * read; anyone else is checked for at least one roster row, so a stale or
 * hand-rolled id cannot own work. `keepOwners` are owners already on the
 * rock's milestones: someone who has since left every team must survive an
 * unrelated edit rather than block the save.
 *
 * On a private rock every assignee must be on the parent team (spec §3.3).
 */
async function assertMilestoneOwners(
  db: Firestore,
  owners: { title: string; ownerId: string | null }[],
  parentIds: ReadonlySet<string>,
  keepOwners: ReadonlySet<string>,
  isPrivate: boolean,
) {
  if (isPrivate) {
    const outside = owners.find(
      (o) => o.ownerId && !parentIds.has(o.ownerId),
    );
    if (outside?.ownerId) {
      const names = await loadUsersById(db, [outside.ownerId]);
      const name = userDisplayName(names.get(outside.ownerId)) || "An assignee";
      throw new Error(
        `${name} is not on this team; private rocks can't have outside assignees. Reassign “${outside.title}” first.`,
      );
    }
    return;
  }
  const outside = [
    ...new Set(
      owners
        .map((o) => o.ownerId)
        .filter(
          (id): id is string => !!id && !parentIds.has(id) && !keepOwners.has(id),
        ),
    ),
  ];
  const rostered = await Promise.all(
    outside.map(async (uid) => {
      const snap = await db
        .collection("team_members")
        .where("user_id", "==", uid)
        .limit(1)
        .get();
      return [uid, !snap.empty] as const;
    }),
  );
  for (const [uid, ok] of rostered) {
    if (ok) continue;
    const m = owners.find((x) => x.ownerId === uid);
    throw new Error(
      `“${m?.title ?? "A milestone"}” is assigned to someone who is not on any team.`,
    );
  }
}

/**
 * Everyone on a team roster, for the milestone owner picker's "Whole org"
 * scope and the audience person picker. The directory is visible to every
 * signed-in person (spec §2.5), so any of them may load it — the audience
 * opens the modal from its own team, not the parent. Lighter than the
 * Directory's loader on purpose — no Identity Platform listing.
 */
export async function loadOrgPeople(): Promise<
  { user_id: string; full_name: string; team_ids: string[] }[]
> {
  const { db } = await requireFirebaseUser();
  const members = await db.collection("team_members").get();
  const teamsByUid = new Map<string, string[]>();
  for (const d of members.docs) {
    const uid = d.data().user_id as string | undefined;
    const tid = d.data().team_id as string | undefined;
    if (!uid || !tid) continue;
    const list = teamsByUid.get(uid) ?? [];
    list.push(tid);
    teamsByUid.set(uid, list);
  }
  const uids = [...teamsByUid.keys()];
  const profiles = await loadUsersById(db, uids);
  return uids
    .map((uid) => ({
      user_id: uid,
      full_name: userDisplayName(profiles.get(uid)) || "Unnamed",
      team_ids: teamsByUid.get(uid) ?? [],
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/**
 * Tell people about milestone hand-offs (spec §5.3): the new owner gets
 * `assigned`, the previous owner `unassigned`, the milestone's followers a
 * `reassigned` event. Best-effort, after the write; `emitEvent` also drops
 * anyone who cannot see the milestone (the unassigned are exempt).
 */
async function notifyMilestoneOwners(
  db: Firestore,
  teamId: string,
  actorId: string,
  changes: { id: string; prevOwnerId: string | null; ownerId: string | null }[],
) {
  for (const c of changes) {
    const { assigned, unassigned } = reassignmentRecipients(
      c.prevOwnerId,
      c.ownerId,
      actorId,
    );
    if (assigned.length === 0 && unassigned.length === 0) continue;
    await emitEvent(
      db,
      { type: "milestone", id: c.id },
      c.prevOwnerId ? "reassigned" : null,
      actorId,
      { teamId, direct: { assigned, unassigned } },
    );
  }
}

function revalidateRockSurfaces(teamId: string, audienceTeamIds: string[]) {
  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath(`/teams/${teamId}/meetings`);
  for (const id of audienceTeamIds) {
    revalidatePath(pathFor(id));
    revalidatePath(`/teams/${id}/meetings`);
  }
  // Blocks: a milestone shows on every team its assignee is on.
  revalidatePath("/teams/[teamId]/rocks", "page");
  revalidatePath("/home");
}

function pathFor(teamId: string) {
  return `/teams/${teamId}/rocks`;
}

function pickAssignment(p: ReturnType<typeof assignmentPatch>) {
  return { assigned_by: p.assigned_by, follower_ids: p.follower_ids };
}

/**
 * Rock-level notification: the new owner is told `assigned`, the previous
 * one `unassigned`, and the followers hear `event` (null = direct only).
 */
async function notifyRockOwner(
  db: Firestore,
  teamId: string,
  rockId: string,
  actorId: string,
  prevOwnerId: string | null,
  ownerId: string | null,
  event: RockEvent | null = null,
) {
  const direct = reassignmentRecipients(prevOwnerId, ownerId, actorId);
  if (direct.assigned.length === 0 && direct.unassigned.length === 0 && !event) {
    return;
  }
  await emitEvent(db, { type: "rock", id: rockId }, event, actorId, {
    teamId,
    direct,
  });
}

export async function createRockWithMilestones(
  teamId: string,
  formData: FormData,
) {
  const { uid, db, isAdmin } = await requireTeamAccess(teamId);
  const { viewer } = await requireViewer();

  const { title, quarter, due_date, description, owner_id, rock_type } =
    await parseRockFields(formData, teamId, null);
  const is_company_rock = companyFlagPatch(formData, isAdmin, null);
  const audience = await audiencePatch(db, formData, teamId, viewer, null);

  const milestones = parseMilestones(formData.get("milestones"));
  const parentIds = new Set((await getTeamMembers(teamId)).map((m) => m.user_id));
  const created = milestones.map((m) => ({
    ref: db.collection("todos").doc(),
    title: m.title,
    // A new milestone is never unassigned.
    ownerId: milestoneOwnerFor(m, owner_id, null) ?? owner_id,
    m,
  }));
  const rockAssign = assignmentPatch("rock", {}, owner_id, uid);
  await assertMilestoneOwners(
    db,
    created.map((c) => ({ title: c.title, ownerId: c.ownerId })),
    parentIds,
    new Set(),
    audience.private,
  );

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
    is_company_rock,
    ...audience,
    ...pickAssignment(rockAssign),
    status: "on_track",
    completed_at: null,
    // Explicit null so the Monday sweep's `archived_at == null` equality
    // filter matches (Firestore never matches a missing field).
    archived_at: null,
    created_at: FieldValue.serverTimestamp(),
  });
  for (const c of created) {
    batch.set(
      c.ref,
      milestoneDoc(
        teamId,
        rockRef.id,
        c.m,
        c.ownerId,
        pickAssignment(assignmentPatch("milestone", {}, c.ownerId, uid)),
      ),
    );
  }
  await batch.commit();

  await notifyMilestoneOwners(
    db,
    teamId,
    uid,
    created.map((c) => ({ id: c.ref.id, prevOwnerId: null, ownerId: c.ownerId })),
  );
  // A new rock: the owner is told they were assigned it, the audience that
  // they were added to it.
  await notifyRockOwner(db, teamId, rockRef.id, uid, null, owner_id);
  await emitAudienceAdded(
    db,
    rockRef.id,
    uid,
    teamId,
    audienceAdded(
      { teamIds: [], userIds: [] },
      { teamIds: audience.audience_team_ids, userIds: audience.audience_user_ids },
      uid,
    ),
  );
  revalidateRockSurfaces(teamId, audience.audience_team_ids);
}

export async function updateRockWithMilestones(
  teamId: string,
  rockId: string,
  formData: FormData,
) {
  // The parent team, the audience and admins may edit (rockAccess.canEdit).
  const { uid, db, isAdmin, viewer, data, rock } = await requireRock(
    teamId,
    rockId,
    rockAccess.canEdit,
  );

  const { title, quarter, due_date, description, owner_id, rock_type } =
    await parseRockFields(formData, teamId, rock.owner_id);
  const is_company_rock = companyFlagPatch(formData, isAdmin, data);
  const audience = await audiencePatch(db, formData, teamId, viewer, rock);

  const milestones = parseMilestones(formData.get("milestones"));
  const keptIds = new Set(
    milestones.map((m) => m.id).filter((id): id is string => !!id),
  );

  const [existingSnap, members] = await Promise.all([
    db
      .collection("todos")
      .where("team_id", "==", teamId)
      .where("source_rock_id", "==", rockId)
      .get(),
    getTeamMembers(teamId),
  ]);
  const parentIds = new Set(members.map((m) => m.user_id));
  const existingById = new Map(existingSnap.docs.map((d) => [d.id, d]));

  // Only milestones the modal was shown may be deleted by leaving them out.
  // An older client that sends no list keeps the previous all-known
  // behaviour.
  const knownRaw = formData.get("known_milestone_ids");
  let known: Set<string> | null = null;
  if (typeof knownRaw === "string" && knownRaw.trim()) {
    try {
      const v = JSON.parse(knownRaw);
      if (Array.isArray(v)) known = new Set(v.map(String));
    } catch {
      throw new Error("Malformed milestone list");
    }
  }

  const planned = milestones.map((m) => {
    const existing = m.id ? existingById.get(m.id) : undefined;
    const ownerId = milestoneOwnerFor(
      m,
      owner_id,
      existing ? existing.data() : null,
    );
    return { m, existing, ownerId };
  });
  // Milestones the modal never saw survive untouched — and still count
  // toward the private-rock assignee rule.
  const untouched = existingSnap.docs.filter(
    (d) => !keptIds.has(d.id) && known && !known.has(d.id),
  );
  await assertMilestoneOwners(
    db,
    [
      ...planned.map((p) => ({ title: p.m.title, ownerId: p.ownerId })),
      ...untouched.map((d) => ({
        title: String(d.data().title ?? ""),
        ownerId: (d.data().owner_id as string | null) ?? null,
      })),
    ],
    parentIds,
    new Set(
      existingSnap.docs
        .map((d) => d.data().owner_id as string | null)
        .filter((x): x is string => !!x),
    ),
    audience.private,
  );

  const rockAssign = assignmentPatch("rock", data, owner_id, uid);
  const batch = db.batch();
  batch.update(db.collection("rocks").doc(rockId), {
    title,
    quarter,
    due_date,
    description,
    owner_id,
    rock_type,
    is_company_rock,
    ...audience,
    // New owner + new assigner lock; the old ones stay as plain followers.
    // Only on a real hand-off, so a plain edit never races a Follow click.
    ...(rockAssign.reassigned ? pickAssignment(rockAssign) : {}),
    // Legacy names, replaced by the fields above (P13 migrates the rest).
    shared_team_ids: FieldValue.delete(),
    team_only: FieldValue.delete(),
    // No longer a read grant (spec §3.3): assignees read their milestone
    // through todos.owner_id, never the rock.
    milestone_owner_ids: FieldValue.delete(),
    // Retired: per-team share levels.
    share_levels: FieldValue.delete(),
  });

  // Rows the user removed in the modal.
  const removed: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const d of existingSnap.docs) {
    if (keptIds.has(d.id)) continue;
    if (known && !known.has(d.id)) continue;
    batch.delete(d.ref);
    removed.push(d);
  }

  const handoffs: {
    id: string;
    prevOwnerId: string | null;
    ownerId: string | null;
  }[] = [];
  for (const { m, existing, ownerId } of planned) {
    if (existing) {
      const prevOwnerId = (existing.data().owner_id as string | null) || null;
      const handoff = !!ownerId && prevOwnerId !== ownerId;
      if (handoff) handoffs.push({ id: existing.id, prevOwnerId, ownerId });
      batch.update(db.collection("todos").doc(existing.id), {
        ...(handoff
          ? pickAssignment(
              assignmentPatch("milestone", existing.data(), ownerId, uid),
            )
          : {}),
        title: m.title,
        owner_id: ownerId,
        due_date: m.due_date,
        visibility: "team",
        // Retired: the milestone lock (spec §3.3).
        team_hidden: FieldValue.delete(),
      });
    } else {
      const ref = db.collection("todos").doc();
      const owner = ownerId ?? owner_id;
      handoffs.push({ id: ref.id, prevOwnerId: null, ownerId: owner });
      batch.set(
        ref,
        milestoneDoc(
          teamId,
          rockId,
          m,
          owner,
          pickAssignment(assignmentPatch("milestone", {}, owner, uid)),
        ),
      );
    }
  }
  await batch.commit();

  await purgeRemovedMilestones(db, removed);
  await notifyMilestoneOwners(db, teamId, uid, handoffs);
  // Rock-level events: owner / due date to the followers, `assigned` and
  // `unassigned` to the two owners, `audience_added` to the new audience.
  const edits = rockEditEvents(
    { owner_id: rock.owner_id, due_date: (data.due_date as string | null) ?? null },
    { owner_id, due_date },
  );
  for (const ev of edits) {
    const ownerEv = ev === "owner_changed";
    await notifyRockOwner(
      db,
      teamId,
      rockId,
      uid,
      ownerEv ? rock.owner_id : null,
      ownerEv ? owner_id : null,
      ev,
    );
  }
  await emitAudienceAdded(
    db,
    rockId,
    uid,
    teamId,
    audienceAdded(
      { teamIds: audienceTeamIdsOf(rock), userIds: audienceUserIdsOf(rock) },
      { teamIds: audience.audience_team_ids, userIds: audience.audience_user_ids },
      uid,
    ),
  );
  revalidateRockSurfaces(teamId, [
    ...new Set([...audienceTeamIdsOf(rock), ...audience.audience_team_ids]),
  ]);
}
