"use server";

import { revalidatePath } from "next/cache";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { notFound } from "next/navigation";
import {
  getTeamMembers,
  requireTeamAccess,
  requireTeamDoc,
} from "@/lib/firebase/teams";
import { canSetRockStatus } from "@/lib/rocks-share";
import { notify } from "@/lib/firebase/notifications";
import { isCompanyRock } from "@/lib/rock-bucket";
import { loadUsersById } from "@/lib/firebase/queries";
import { userDisplayName } from "@/lib/user-name";
import { isRockStatus } from "./status";
import { isRockType } from "./rock-type";

function pathFor(teamId: string) {
  return `/teams/${teamId}/rocks`;
}

function sharedTeamIdsOf(data: Record<string, unknown> | undefined): string[] {
  return Array.isArray(data?.shared_team_ids)
    ? (data!.shared_team_ids as string[]).filter((x) => typeof x === "string")
    : [];
}

/**
 * Fetch a rock for a status write made from `teamId`.
 *
 * Normally the rock must live on that team. The one exception is a rock shared
 * into the team: its **person owner** can move its status from the guest
 * team's list or L10 without switching teams. Everyone else on the guest team
 * sees it read-only, and every structural edit (title, archive, delete,
 * milestones, re-share) still belongs to the parent team.
 *
 * firestore.rules keeps the client-side contract in step — guests may read a
 * shared rock but not write it. This runs on the Admin SDK, which bypasses
 * rules, so this function is the actual gate.
 */
async function requireStatusWritableRock(
  db: Firestore,
  rockId: string,
  teamId: string,
  uid: string,
) {
  const snap = await db.collection("rocks").doc(rockId).get();
  if (!snap.exists) notFound();
  const data = snap.data() ?? {};
  if (data.team_id === teamId) return snap;

  const writable = canSetRockStatus(
    {
      team_id: String(data.team_id ?? ""),
      owner_id: (data.owner_id as string | null) ?? null,
      shared_team_ids: Array.isArray(data.shared_team_ids)
        ? (data.shared_team_ids as string[])
        : [],
    },
    teamId,
    uid,
  );
  if (writable) return snap;

  notFound();
}

export async function setRockType(
  teamId: string,
  rockId: string,
  rockType: string,
) {
  if (!isRockType(rockType) || rockType === "company") {
    throw new Error("Bad rock type");
  }

  const { db } = await requireTeamAccess(teamId);
  const snap = await requireTeamDoc(db, "rocks", rockId, teamId);
  await db.collection("rocks").doc(rockId).update({ rock_type: rockType });

  revalidateRockSurfaces(teamId, sharedTeamIdsOf(snap.data()));
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
  const rockSnap = await requireStatusWritableRock(db, rockId, teamId, uid);
  const prevStatus = String(rockSnap.data()?.status ?? "");
  // A shared-in rock's history stays on its parent team, not the guest team.
  const rockTeamId = String(rockSnap.data()?.team_id ?? teamId);

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
    // Parent team, not the viewing team — the Rocks tab and L10 both read
    // history with `where team_id == <this team>`, so a note filed under the
    // guest team would vanish from the rock's own history.
    team_id: rockTeamId,
    status,
    comment: trimmed,
    user_id: uid,
    created_at: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  // Parent team + every guest team the rock is shared into (the L10 rocks
  // segment shows StatusPopover too; keep RSC payloads fresh for anyone who
  // lands mid-meeting without a client subscription yet). `teamId` may be a
  // guest team when the owner moved a shared-in rock from there — it is in
  // the shared list, so it is covered.
  revalidateRockSurfaces(rockTeamId, sharedTeamIdsOf(rockSnap.data()));
  if (rockTeamId !== teamId) revalidatePath(pathFor(teamId));
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
  const snap = await requireTeamDoc(db, "rocks", rockId, teamId);
  await db
    .collection("rocks")
    .doc(rockId)
    .update(
      archived
        ? { archived_at: FieldValue.serverTimestamp() }
        : { archived_at: null, completed_at: null },
    );

  revalidateRockSurfaces(teamId, sharedTeamIdsOf(snap.data()));
}

// Removes the rock, linked milestones (todos), and entity_comments.
// Single batch so a partial failure can't orphan children.
export async function deleteRock(teamId: string, rockId: string) {
  const { db } = await requireTeamAccess(teamId);
  const rockSnap = await requireTeamDoc(db, "rocks", rockId, teamId);

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

  revalidateRockSurfaces(teamId, sharedTeamIdsOf(rockSnap.data()));
}

// The redesigned modal (rock-modal.tsx) saves a rock and its milestones in one
// step, so both of these take a `milestones` field: a JSON array of
// { id?, title, owner_id, due_date, locked }. `id` present = existing todo
// doc to update; absent = create. On an edit, a milestone the modal was
// *shown* (`known_milestone_ids`) and that is missing from the array is
// deleted. One batch, so the list can never show a rock whose milestones
// silently failed to write.

type MilestoneInput = {
  id?: string;
  title: string;
  owner_id: string;
  due_date: string | null;
  /** Locked: not passed on to the assignee's teams (lib/rocks-share.ts). */
  locked: boolean;
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
      return {
        id,
        title,
        owner_id,
        due_date: dueRaw || null,
        locked: x.locked === true,
      };
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
    // A milestone is always team-visible as a to-do. Its sharing lock is a
    // separate flag: "private" on a to-do means owner-only everywhere (Home,
    // notifications, rules), which is not what the lock means.
    visibility: "team" as const,
    team_hidden: m.locked,
    source_issue_id: null,
    source_meeting_id: null,
    source_rock_id: rockId,
    created_at: FieldValue.serverTimestamp(),
  };
}

// Cap guest shares so Firestore rules can check a fixed prefix of
// shared_team_ids (see firestore.rules sharedRockAccess when deployed).
const MAX_SHARED_TEAMS = 8;

/**
 * Rock fields from the modal. Owner is always a person; kind is separate
 * (individual / department); optional shared_team_ids. The Company flag is
 * NOT parsed here — it is admin-gated and handled by the caller, because the
 * right default differs between create and update (see companyFlagPatch).
 */
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
    description: String(formData.get("description") ?? "").trim() || null,
    owner_id: ownerRaw || uid,
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

/**
 * "Keep on this team" (lib/rocks-share.ts): every milestone treated as
 * locked. Excludes team shares — a rock can't be kept on its team and shared
 * with others; the modal disables one while the other is on, and this
 * refuses a hand-rolled form that sends both.
 */
function parseTeamOnly(formData: FormData, sharedTeamIds: string[]): boolean {
  const on = formData.get("team_only") === "true";
  if (on && sharedTeamIds.length > 0) {
    throw new Error(
      "A rock kept on its team can't also be shared — remove the shared teams or turn off “Keep on this team”.",
    );
  }
  return on;
}

function parseSharedTeamIds(
  formData: FormData,
  homeTeamId: string,
  allowedTeamIds: Set<string>,
): string[] {
  const raw = formData.get("shared_team_ids");
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Malformed shared teams payload");
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const id = String(item ?? "").trim();
    if (!id || id === homeTeamId || seen.has(id)) continue;
    if (!allowedTeamIds.has(id)) {
      throw new Error("Unknown team — pick from the directory list.");
    }
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_SHARED_TEAMS) break;
  }
  return out;
}

/**
 * A milestone owner must be a person on some team in the org (N66 — the
 * picker's "Whole org" scope). Anyone on the rock's own teams passes without
 * a read; anyone else is checked for at least one roster row, so a stale or
 * hand-rolled id cannot own work. `keepOwners` are owners already on the
 * rock's milestones: someone who has since left every team must survive an
 * unrelated edit rather than block the save.
 *
 * An owner outside the rock's teams sees the rock's headline and their own
 * milestone only (canSeeMilestone), on Home.
 */
async function assertMilestoneOwners(
  db: Firestore,
  milestones: MilestoneInput[],
  fallbackOwner: string,
  teamIds: string[],
  keepOwners: ReadonlySet<string>,
) {
  const rosters = await Promise.all(teamIds.map((id) => getTeamMembers(id)));
  const onRockTeams = new Set(rosters.flat().map((m) => m.user_id));
  const outside = [
    ...new Set(
      milestones
        .map((m) => m.owner_id || fallbackOwner)
        .filter((id) => !onRockTeams.has(id) && !keepOwners.has(id)),
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
    const m = milestones.find((x) => (x.owner_id || fallbackOwner) === uid);
    throw new Error(
      `“${m?.title ?? "A milestone"}” is assigned to someone who is not on any team.`,
    );
  }
}

/**
 * Everyone on a team roster, for the milestone owner picker's "Whole org"
 * scope. Fetched only when that scope is opened. Lighter than the Directory's
 * loader on purpose — no Identity Platform listing — since an owner has to
 * be rostered somewhere anyway (assertMilestoneOwners).
 */
export async function loadOrgPeople(
  teamId: string,
): Promise<{ user_id: string; full_name: string; team_ids: string[] }[]> {
  const { db } = await requireTeamAccess(teamId);
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

async function allowedShareTeamIds(db: Firestore): Promise<Set<string>> {
  // Share-down: a parent-team member may share into any org team, not only
  // teams they sit on. Leadership → ESD is the case that failed when the
  // picker was membership-only.
  const snap = await db.collection("teams").get();
  return new Set(snap.docs.map((d) => d.id));
}

/**
 * Tell people they were handed a milestone (review item 5, 2026-09-22).
 * One "assigned" row per milestone whose owner is new and isn't the actor —
 * for someone outside the rock's teams it is the only way they'd learn of
 * it. Best-effort, after the write, like every other notification.
 */
async function notifyAssignments(
  db: Firestore,
  team: { id: string; name: string },
  actorId: string,
  assigned: { id: string; title: string; ownerId: string }[],
) {
  for (const m of assigned) {
    if (m.ownerId === actorId) continue;
    await notify({
      db,
      recipientIds: [m.ownerId],
      kind: "assigned",
      team,
      entity: { type: "todo", id: m.id, title: m.title },
      actor: { id: actorId },
    });
  }
}

/** Owners of every milestone on the rock after this save — denormalised
 *  onto the rock so firestore.rules can grant assignees the rock's comments
 *  and status history (lib/rocks-share.ts hasFullRockView, client half). */
function ownerIdsOf(ids: Iterable<string | null | undefined>): string[] {
  return [...new Set([...ids].filter((x): x is string => !!x))];
}

function revalidateRockSurfaces(teamId: string, sharedTeamIds: string[]) {
  revalidatePath(pathFor(teamId));
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath(`/teams/${teamId}/meetings`);
  for (const id of sharedTeamIds) {
    revalidatePath(pathFor(id));
    revalidatePath(`/teams/${id}/meetings`);
  }
  revalidatePath("/home");
}

export async function createRockWithMilestones(
  teamId: string,
  formData: FormData,
) {
  const { uid, db, isAdmin, team } = await requireTeamAccess(teamId);

  const { title, quarter, due_date, description, owner_id, rock_type } =
    parseRockFields(formData, uid);
  const is_company_rock = companyFlagPatch(formData, isAdmin, null);

  const allowed = await allowedShareTeamIds(db);
  const shared_team_ids = parseSharedTeamIds(formData, teamId, allowed);
  const team_only = parseTeamOnly(formData, shared_team_ids);

  const milestones = parseMilestones(formData.get("milestones"));
  await assertMilestoneOwners(
    db,
    milestones,
    owner_id,
    [teamId, ...shared_team_ids],
    new Set(),
  );

  const rockRef = db.collection("rocks").doc();
  const batch = db.batch();
  const created = milestones.map((m) => ({
    ref: db.collection("todos").doc(),
    title: m.title,
    ownerId: m.owner_id || owner_id,
    m,
  }));
  batch.set(rockRef, {
    team_id: teamId,
    title,
    quarter,
    due_date,
    owner_id,
    description,
    rock_type,
    is_company_rock,
    shared_team_ids,
    team_only,
    milestone_owner_ids: ownerIdsOf(created.map((c) => c.ownerId)),
    status: "on_track",
    completed_at: null,
    // Explicit null so the Monday sweep's `archived_at == null` equality
    // filter matches (Firestore never matches a missing field).
    archived_at: null,
    created_at: FieldValue.serverTimestamp(),
  });
  for (const c of created) {
    batch.set(c.ref, milestoneDoc(teamId, rockRef.id, c.m, owner_id));
  }
  await batch.commit();

  await notifyAssignments(
    db,
    { id: teamId, name: team.name },
    uid,
    created.map((c) => ({ id: c.ref.id, title: c.title, ownerId: c.ownerId })),
  );
  revalidateRockSurfaces(teamId, shared_team_ids);
}

export async function updateRockWithMilestones(
  teamId: string,
  rockId: string,
  formData: FormData,
) {
  const { uid, db, isAdmin, team } = await requireTeamAccess(teamId);

  const { title, quarter, due_date, description, owner_id, rock_type } =
    parseRockFields(formData, uid);

  const allowed = await allowedShareTeamIds(db);
  const shared_team_ids = parseSharedTeamIds(formData, teamId, allowed);
  const team_only = parseTeamOnly(formData, shared_team_ids);

  const milestones = parseMilestones(formData.get("milestones"));
  const keptIds = new Set(
    milestones.map((m) => m.id).filter((id): id is string => !!id),
  );

  // The ownership check and the milestone read are independent — one round
  // trip, not two.
  const [rockSnap, existingSnap] = await Promise.all([
    requireTeamDoc(db, "rocks", rockId, teamId),
    db
      .collection("todos")
      .where("team_id", "==", teamId)
      .where("source_rock_id", "==", rockId)
      .get(),
  ]);
  const is_company_rock = companyFlagPatch(
    formData,
    isAdmin,
    rockSnap.data() ?? null,
  );
  await assertMilestoneOwners(
    db,
    milestones,
    owner_id,
    [teamId, ...shared_team_ids],
    new Set(
      existingSnap.docs
        .map((d) => d.data().owner_id as string | null)
        .filter((x): x is string => !!x),
    ),
  );

  // Only milestones the modal was shown may be deleted by leaving them out.
  // Surfaces filter what they load (an assignment row carries only its
  // carrier's milestones), so "absent from the array" alone
  // would silently delete whatever the editor's surface never loaded. An
  // older client that sends no list keeps the previous all-known behaviour.
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

  const batch = db.batch();
  batch.update(db.collection("rocks").doc(rockId), {
    title,
    quarter,
    due_date,
    description,
    owner_id,
    rock_type,
    is_company_rock,
    shared_team_ids,
    team_only,
    // Retired: per-team share levels. Every team share is full now.
    share_levels: FieldValue.delete(),
  });

  // Rows the user removed in the modal.
  for (const d of existingSnap.docs) {
    if (keptIds.has(d.id)) continue;
    if (known && !known.has(d.id)) continue;
    batch.delete(d.ref);
  }

  const existingById = new Map(existingSnap.docs.map((d) => [d.id, d]));
  const fallbackOwner = owner_id;
  const assigned: { id: string; title: string; ownerId: string }[] = [];
  const ownersAfter: (string | null)[] = [];
  for (const m of milestones) {
    const ownerId = m.owner_id || fallbackOwner;
    ownersAfter.push(ownerId);
    const existing = m.id ? existingById.get(m.id) : undefined;
    if (existing) {
      if (String(existing.data().owner_id ?? "") !== ownerId) {
        assigned.push({ id: existing.id, title: m.title, ownerId });
      }
      batch.update(db.collection("todos").doc(existing.id), {
        title: m.title,
        owner_id: ownerId,
        due_date: m.due_date,
        visibility: "team",
        team_hidden: m.locked,
      });
    } else {
      const ref = db.collection("todos").doc();
      assigned.push({ id: ref.id, title: m.title, ownerId });
      batch.set(ref, milestoneDoc(teamId, rockId, m, fallbackOwner));
    }
  }
  // Milestones the modal never saw survive untouched — and keep their owner
  // on the rock's list.
  for (const d of existingSnap.docs) {
    if (!keptIds.has(d.id) && known && !known.has(d.id)) {
      ownersAfter.push((d.data().owner_id as string | null) ?? null);
    }
  }
  batch.update(db.collection("rocks").doc(rockId), {
    milestone_owner_ids: ownerIdsOf(ownersAfter),
  });
  await batch.commit();

  await notifyAssignments(db, { id: teamId, name: team.name }, uid, assigned);
  revalidateRockSurfaces(teamId, shared_team_ids);
}
