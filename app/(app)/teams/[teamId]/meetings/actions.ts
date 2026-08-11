"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  getTeamMembers,
  requireTeamAccess,
  requireTeamDoc,
  requireTeamLeader,
} from "@/lib/firebase/teams";
import {
  type Segment,
  normalizeSegment,
} from "@/lib/l10/segments";
import {
  BUILT_IN_AGENDA_PRESETS,
  agendaIncludesSegment,
  defaultL10Items,
  firstAgendaSegment,
  nextInAgenda,
  normalizeAgendaItems,
  prevInAgenda,
  resolveMeetingAgenda,
  validateAgendaName,
  type AgendaItem,
} from "@/lib/l10/agenda";
import {
  clampSpeakerIndex,
  firstPresentIndex,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";
import { archiveHeadlinesDiscussedDuringMeeting } from "../headlines/actions";
import { archiveIssuesClosedDuringMeeting } from "../issues/actions";
import { archiveTodosCompletedDuringMeeting } from "../todos/actions";

function listPath(teamId: string) {
  return `/teams/${teamId}/meetings`;
}
function detailPath(teamId: string, meetingId: string) {
  return `/teams/${teamId}/meetings/${meetingId}`;
}

// ---------------------------------------------------------------------------
// Agenda templates (per-team). Leaders create/edit; any member may read.
// A snapshot is stamped onto each meeting at start so later template edits
// never rewrite a live or historical meeting.
// ---------------------------------------------------------------------------

/** Seed Level 10 + L10 Condensed when a team has no agendas yet.
 *  Uses deterministic doc ids so concurrent first visits can't double-seed. */
export async function ensureDefaultAgendas(teamId: string): Promise<void> {
  const { db, uid } = await requireTeamAccess(teamId);
  const existing = await db
    .collection("agendas")
    .where("team_id", "==", teamId)
    .limit(1)
    .get();
  if (!existing.empty) return;

  const batch = db.batch();
  for (const preset of BUILT_IN_AGENDA_PRESETS) {
    // Stable id: concurrent ensureDefaultAgendas calls merge instead of
    // minting four Level-10s for one team.
    const ref = db.collection("agendas").doc(`${teamId}__${preset.key}`);
    batch.set(
      ref,
      {
        team_id: teamId,
        name: preset.name,
        items: preset.items(),
        is_default: preset.is_default,
        created_by: uid,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await batch.commit();
  // No revalidatePath here: this runs from the Meetings page render on first
  // visit (seed-if-empty). revalidatePath during render is unsupported in
  // Next.js. The same request already re-queries agendas after this returns.
}

export async function createAgenda(
  teamId: string,
  input: { name: string; items: AgendaItem[] },
): Promise<{ id: string }> {
  const { db, uid } = await requireTeamLeader(teamId);
  const name = validateAgendaName(input.name);
  const items = normalizeAgendaItems(input.items);
  if (!items) throw new Error("Agenda needs at least one stage");

  const ref = db.collection("agendas").doc();
  await ref.set({
    team_id: teamId,
    name,
    items,
    is_default: false,
    created_by: uid,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  revalidatePath(listPath(teamId));
  return { id: ref.id };
}

export async function updateAgenda(
  teamId: string,
  agendaId: string,
  input: { name: string; items: AgendaItem[] },
): Promise<void> {
  const { db } = await requireTeamLeader(teamId);
  await requireTeamDoc(db, "agendas", agendaId, teamId);
  const name = validateAgendaName(input.name);
  const items = normalizeAgendaItems(input.items);
  if (!items) throw new Error("Agenda needs at least one stage");

  await db.collection("agendas").doc(agendaId).update({
    name,
    items,
    updated_at: FieldValue.serverTimestamp(),
  });
  revalidatePath(listPath(teamId));
}

export async function deleteAgenda(
  teamId: string,
  agendaId: string,
): Promise<void> {
  const { db } = await requireTeamLeader(teamId);
  const snap = await requireTeamDoc(db, "agendas", agendaId, teamId);
  if (snap.data()?.is_default) {
    throw new Error("The default Level 10 agenda cannot be deleted");
  }
  // Keep at least one template so Start meeting always has a choice.
  const siblings = await db
    .collection("agendas")
    .where("team_id", "==", teamId)
    .limit(2)
    .get();
  if (siblings.size <= 1) {
    throw new Error("Keep at least one agenda for the team");
  }
  await db.collection("agendas").doc(agendaId).delete();
  revalidatePath(listPath(teamId));
}

async function loadAgendaSnapshot(
  db: Firestore,
  teamId: string,
  agendaId: string | null | undefined,
): Promise<{
  agenda_id: string | null;
  agenda_name: string;
  agenda_items: AgendaItem[];
}> {
  if (agendaId) {
    const snap = await db.collection("agendas").doc(agendaId).get();
    if (snap.exists && snap.data()?.team_id === teamId) {
      const items = normalizeAgendaItems(snap.data()?.items);
      if (items) {
        return {
          agenda_id: snap.id,
          agenda_name:
            String(snap.data()?.name ?? "Agenda").trim() || "Agenda",
          agenda_items: items,
        };
      }
    }
  }
  // Prefer the team's default template when none (or a stale id) was chosen.
  // Filter in memory so we don't need a composite team_id+is_default index.
  const teamAgendas = await db
    .collection("agendas")
    .where("team_id", "==", teamId)
    .get();
  const preferred =
    teamAgendas.docs.find((d) => d.data().is_default) ??
    teamAgendas.docs[0] ??
    null;
  if (preferred) {
    const items =
      normalizeAgendaItems(preferred.data().items) ?? defaultL10Items();
    return {
      agenda_id: preferred.id,
      agenda_name:
        String(preferred.data().name ?? "Level 10").trim() || "Level 10",
      agenda_items: items,
    };
  }
  return {
    agenda_id: null,
    agenda_name: "Level 10",
    agenda_items: defaultL10Items(),
  };
}

// Group-transport action — starting the shared L10 room is a facilitator
// control, so it requires team leader OR org admin (bypass built into
// requireTeamLeader). Non-leader members 404 rather than minting a meeting.
//
// `agendaId` selects the template; its stages + durations are snapshotted
// onto the meeting doc so later template edits never rewrite a live room.
export async function startMeeting(
  teamId: string,
  agendaId?: string | null,
) {
  const { db, team } = await requireTeamLeader(teamId);

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

  // Fresh Issues hour: clear last meeting's vote tallies + any leftover credits
  // so ranking starts at zero. Tallies are kept on issue docs between meetings
  // (so the Issues tab still shows how the room ranked them after Finish).
  await resetTeamIssueVotes(db, teamId);

  // Take a copy of the team's durable rotation for this meeting. Reconciling
  // here (rather than trusting the stored array) means a meeting always opens
  // with an order that matches today's roster, and a team that has never set
  // one gets the alphabetical roster instead of an empty rail.
  const members = await getTeamMembers(teamId);
  const speakingOrder = reconcileSpeakingOrder(team.speakingOrder, members);

  const agenda = await loadAgendaSnapshot(db, teamId, agendaId);
  const first = firstAgendaSegment(agenda.agenda_items);

  const ref = db.collection("meetings").doc();
  await ref.set({
    team_id: teamId,
    started_at: FieldValue.serverTimestamp(),
    ended_at: null,
    current_segment: first,
    segment_started_at: FieldValue.serverTimestamp(),
    current_issue_id: null,
    notes: null,
    absent_user_ids: [],
    speaking_order: speakingOrder,
    speaking_index: 0,
    agenda_id: agenda.agenda_id,
    agenda_name: agenda.agenda_name,
    agenda_items: agenda.agenda_items,
  });
  revalidatePath(`/teams/${teamId}/issues`);
  redirect(detailPath(teamId, ref.id));
}

// Wipe per-user vote credits and denormalized issue.votes for a team.
// Used at L10 start so each meeting re-ranks from a clean slate; not at end,
// so the Issues tab keeps last-meeting totals until the next L10 begins.
async function resetTeamIssueVotes(db: Firestore, teamId: string) {
  const [voteRows, issueRows] = await Promise.all([
    db.collection("issue_votes").where("team_id", "==", teamId).get(),
    db.collection("issues").where("team_id", "==", teamId).get(),
  ]);
  // Batches cap at 500 ops; teams are well under that for votes + issues.
  const batch = db.batch();
  voteRows.docs.forEach((d) => batch.delete(d.ref));
  issueRows.docs.forEach((d) => {
    if ((d.data().votes ?? 0) !== 0) batch.update(d.ref, { votes: 0 });
  });
  if (!voteRows.empty || issueRows.docs.some((d) => (d.data().votes ?? 0) !== 0)) {
    await batch.commit();
  }
}

// Group-transport action — moves the shared current_segment for everyone in
// the room, so only a team leader or org admin (bypass built into
// requireTeamLeader) may drive it. Members keep local peek (?view=) via the
// rail; this only gates the write that moves the *group's* stage.
export async function advanceSegment(
  teamId: string,
  meetingId: string,
  direction: "next" | "prev",
  // The segment the clicking client believed was active. When two people hit
  // Next in the same second, the second write sees the segment has already
  // moved and no-ops instead of skipping a stage.
  expectedCurrent?: Segment,
) {
  const { db } = await requireTeamLeader(teamId);
  const ref = db.collection("meetings").doc(meetingId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.team_id !== teamId) {
      throw new Error("Meeting not found");
    }
    // A concluded meeting has nothing to drive — a stale tab clicking Next
    // after someone finished must not rewrite history.
    if (snap.data()?.ended_at != null) return;

    const agenda = resolveMeetingAgenda(snap.data() as {
      agenda_id?: string | null;
      agenda_name?: string | null;
      agenda_items?: unknown;
    });
    const current =
      normalizeSegment(snap.data()?.current_segment as string) ??
      firstAgendaSegment(agenda.agenda_items);
    if (
      expectedCurrent &&
      current !== (normalizeSegment(expectedCurrent) ?? expectedCurrent)
    ) {
      return;
    }

    const target =
      direction === "next"
        ? nextInAgenda(agenda.agenda_items, current)
        : prevInAgenda(agenda.agenda_items, current);
    // "done" is only ever written by endMeeting (the Finish button) — Next on
    // the last agenda stage stops there rather than stranding a live meeting
    // in a state the page has no rendering for.
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

// Same class of control as advanceSegment (writes the shared current_segment
// directly rather than stepping it) — leader/admin-gated for the same
// reason, even though nothing currently calls this (the rail peeks locally
// instead; see docs/L10_GAPS.md).
export async function jumpToSegment(
  teamId: string,
  meetingId: string,
  target: Segment,
) {
  if (target === "done") {
    throw new Error("Invalid segment");
  }
  const { db } = await requireTeamLeader(teamId);
  const snap = await requireTeamDoc(db, "meetings", meetingId, teamId);
  const agenda = resolveMeetingAgenda(snap.data() as {
    agenda_id?: string | null;
    agenda_name?: string | null;
    agenda_items?: unknown;
  });
  if (!agendaIncludesSegment(agenda.agenda_items, target)) {
    throw new Error("Segment is not on this meeting's agenda");
  }
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

// Group-transport action — ending the meeting is a facilitator control
// (Finish), leader/admin-gated the same as advanceSegment/startMeeting.
export async function endMeeting(teamId: string, meetingId: string) {
  const { db } = await requireTeamLeader(teamId);
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

  // Personal vote credits reset at end so no one opens the next L10 already
  // "out of votes". Team tallies (issues.votes) stay until the next Start —
  // the Issues tab shows last meeting's ranking in between.
  if (didEnd) {
    try {
      const voteRows = await db
        .collection("issue_votes")
        .where("team_id", "==", teamId)
        .get();
      if (!voteRows.empty) {
        const batch = db.batch();
        voteRows.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (e) {
      // Meeting is already ended — do not fail Finish over vote cleanup.
      console.error("[endMeeting] vote reset failed:", e);
    }
    try {
      // Closed *in this L10* only → Archived (team saw it). Standing headlines
      // and mid-week closes stay until Monday worker.
      await archiveHeadlinesDiscussedDuringMeeting(teamId, meetingId);
    } catch (e) {
      console.error(
        "[endMeeting] archiveHeadlinesDiscussedDuringMeeting failed:",
        e,
      );
    }
    try {
      await archiveTodosCompletedDuringMeeting(teamId, meetingId);
    } catch (e) {
      console.error(
        "[endMeeting] archiveTodosCompletedDuringMeeting failed:",
        e,
      );
    }
    try {
      await archiveIssuesClosedDuringMeeting(teamId, meetingId);
    } catch (e) {
      console.error(
        "[endMeeting] archiveIssuesClosedDuringMeeting failed:",
        e,
      );
    }
  }
  revalidatePath(detailPath(teamId, meetingId));
  revalidatePath(listPath(teamId));
  revalidatePath(`/teams/${teamId}/issues`);
  revalidatePath(`/teams/${teamId}/headlines`);
  revalidatePath(`/teams/${teamId}/todos`);
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

