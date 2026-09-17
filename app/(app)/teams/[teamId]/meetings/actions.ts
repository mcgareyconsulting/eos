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
  defaultL10Items,
  firstAgendaSegment,
  nextInAgenda,
  normalizeAgendaItems,
  prevInAgenda,
  resolveBuiltInAgenda,
  resolveMeetingAgenda,
  validateAgendaName,
  type AgendaItem,
} from "@/lib/l10/agenda";
import {
  clampSpeakerIndex,
  firstPresentIndex,
  reconcileSpeakingOrder,
} from "@/lib/l10/speaking-order";
import {
  canDrive,
  isStaleLiveMeeting,
  isUnclaimed,
} from "@/lib/l10/driver";
import { archiveHeadlinesDiscussedDuringMeeting } from "../headlines/actions";
import { archiveIssuesClosedDuringMeeting } from "../issues/actions";
import { archiveTodosCompletedDuringMeeting } from "../todos/actions";
import {
  RATING_LOCKED_MESSAGE,
  ratingWriteAllowed,
} from "@/lib/l10/ratings";

function listPath(teamId: string) {
  return `/teams/${teamId}/meetings`;
}
function detailPath(teamId: string, meetingId: string) {
  return `/teams/${teamId}/meetings/${meetingId}`;
}

// ---------------------------------------------------------------------------
// Custom agenda templates (per-team Firestore docs). Built-ins live in code
// (see lib/l10/agenda.ts) and need no seed. Snapshot stamped at meeting start.
// ---------------------------------------------------------------------------

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
  await requireTeamDoc(db, "agendas", agendaId, teamId);
  await db.collection("agendas").doc(agendaId).delete();
  revalidatePath(listPath(teamId));
}

/** Built-in id (`builtin:l10`) or a team custom agenda doc id. */
async function loadAgendaSnapshot(
  db: Firestore,
  teamId: string,
  agendaId: string | null | undefined,
): Promise<{
  agenda_id: string | null;
  agenda_name: string;
  agenda_items: AgendaItem[];
}> {
  const builtin = resolveBuiltInAgenda(agendaId);
  if (builtin) return builtin;

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

  // Fallback: Level 10 built-in (always available).
  return (
    resolveBuiltInAgenda("builtin:l10") ?? {
      agenda_id: "builtin:l10",
      agenda_name: "Level 10",
      agenda_items: defaultL10Items(),
    }
  );
}

// Anyone on the team may start a meeting, and whoever does takes the wheel
// (`driver_id`) — see lib/l10/driver.ts. This used to require a team leader,
// which meant a room whose leader was out could not be opened by the seven
// people sitting in it.
//
// `agendaId` selects the template; its stages + durations are snapshotted
// onto the meeting doc so later template edits never rewrite a live room.
export async function startMeeting(
  teamId: string,
  agendaId?: string | null,
) {
  const { uid, db, team } = await requireTeamAccess(teamId);

  // One live meeting per team: if someone already started one, join it
  // instead of minting a duplicate — two people clicking Start at 9:00 (or a
  // double-click on the button) must land everyone in the same room.
  //
  // But only a *recent* one. A meeting nobody pressed Finish on stays
  // `ended_at == null` forever, and joining it silently made last week's room
  // into this week's meeting: stale vote tallies (the reset below never runs
  // on the join path), last week's agenda snapshot, last week's rotation.
  // Anything untouched past the cutoff is reaped here instead.
  const openSnap = await db
    .collection("meetings")
    .where("team_id", "==", teamId)
    .where("ended_at", "==", null)
    .get();

  const nowMs = Date.now();
  const stale: typeof openSnap.docs = [];
  let joinable: { id: string; lastActivityMs: number } | null = null;
  for (const d of openSnap.docs) {
    const lastActivityMs =
      (d.data().segment_started_at as { toMillis?: () => number } | null)
        ?.toMillis?.() ??
      (d.data().started_at as { toMillis?: () => number } | null)
        ?.toMillis?.() ??
      null;
    if (isStaleLiveMeeting({ lastActivityMs, nowMs })) {
      stale.push(d);
      continue;
    }
    // Two live rooms should not exist, but if they do, the freshest one is
    // the one people are actually in.
    if (!joinable || (lastActivityMs ?? 0) > joinable.lastActivityMs) {
      joinable = { id: d.id, lastActivityMs: lastActivityMs ?? 0 };
    }
  }

  if (stale.length > 0) {
    // Closed at its last sign of life, not at now: a meeting abandoned last
    // Tuesday lasted an hour, not a week, and the recap reads `ended_at`.
    // `ended_reason` marks it as reaped rather than concluded — nobody rated
    // it, and none of the conclude-time archive sweeps ran for it.
    const batch = db.batch();
    for (const d of stale) {
      batch.update(d.ref, {
        ended_at:
          d.data().segment_started_at ??
          d.data().started_at ??
          FieldValue.serverTimestamp(),
        ended_reason: "stale",
        current_segment: "done",
      });
    }
    await batch.commit();
  }

  if (joinable) {
    redirect(detailPath(teamId, joinable.id));
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
    // Whoever starts it drives it. `started_by` is the historical fact and
    // never changes; `driver_id` is the wheel and moves with every takeover.
    started_by: uid,
    driver_id: uid,
    driver_since: FieldValue.serverTimestamp(),
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
// the room, so only the meeting's *driver* (or an org admin) may call it.
// Anyone else takes the wheel first (takeWheel below), which is one click and
// never refused. Members keep local peek (?view=) via the rail; this only
// gates the write that moves the *group's* stage.
export async function advanceSegment(
  teamId: string,
  meetingId: string,
  direction: "next" | "prev",
  // The segment the clicking client believed was active. When two people hit
  // Next in the same second, the second write sees the segment has already
  // moved and no-ops instead of skipping a stage.
  expectedCurrent?: Segment,
) {
  const { uid, db, isAdmin } = await requireTeamAccess(teamId);
  const ref = db.collection("meetings").doc(meetingId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.team_id !== teamId) {
      throw new Error("Meeting not found");
    }
    // A concluded meeting has nothing to drive — a stale tab clicking Next
    // after someone finished must not rewrite history.
    if (snap.data()?.ended_at != null) return;

    // Read the wheel inside the transaction: two people taking over in the
    // same second must not both advance off one stale read. A no-op rather
    // than a throw, like the expectedCurrent guard below: the realistic way
    // to get here is someone taking the wheel a beat before your click
    // landed, and that is a stale rail to re-render, not an error page.
    const driverId = (snap.data()?.driver_id as string | null) ?? null;
    if (!canDrive({ driverId, uid, isAdmin })) return;

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
      // Meetings started before `driver_id` shipped are unclaimed: anyone may
      // drive them, and driving is what claims the wheel. Cheaper than a
      // backfill, and the room sees a name instead of "nobody".
      ...(isUnclaimed(driverId)
        ? { driver_id: uid, driver_since: FieldValue.serverTimestamp() }
        : {}),
    });
  });

  revalidatePath(detailPath(teamId, meetingId));
}

/**
 * Take the wheel.
 *
 * Deliberately unrestricted: any member of the team may take over driving, at
 * any time, without the current driver's consent. The alternative — a wheel
 * only its holder can pass on — strands the room the moment someone's laptop
 * dies mid-Issues, which is the failure this whole model exists to prevent.
 * What keeps it honest is visibility, not permission: `driver_id` is on the
 * meeting doc every client subscribes to, so a takeover renames the pill on
 * every screen in the room at once.
 *
 * No revalidatePath — the snapshot delivers it (same reasoning as
 * setDiscussingIssue). The caller refreshes its own server content so the
 * transport buttons appear for a client whose subscription is blocked.
 */
export async function takeWheel(teamId: string, meetingId: string) {
  const { uid, db } = await requireTeamAccess(teamId);
  const ref = db.collection("meetings").doc(meetingId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.team_id !== teamId) {
      throw new Error("Meeting not found");
    }
    // Ended under you (Finish landed first): nothing to hold. The caller's
    // refresh shows the recap.
    if (snap.data()?.ended_at != null) return;
    // Already yours (double-click, or two tabs): don't churn driver_since.
    if (snap.data()?.driver_id === uid) return;
    tx.update(ref, {
      driver_id: uid,
      driver_since: FieldValue.serverTimestamp(),
    });
  });
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

/**
 * Open or close the room's voting window.
 *
 * Lives on the meeting doc next to `current_issue_id`, for the same reason: it
 * is room state, not viewer state. Everyone's Issues segment is already
 * subscribed to this document, so opening the vote lands on every screen at
 * once and there is no way for two people to disagree about whether voting is
 * live.
 *
 * This replaces the earlier implicit hold, which released when
 * `teamVoteTally` said every credit was spent. That release was only reachable
 * if attendance was accurate — one person marked present but not in the room
 * would hold the list frozen for the rest of the hour. An explicit window has
 * no such dependency: the facilitator closes it, and the list sorts.
 *
 * Not leader-gated, matching `setDiscussingIssue`: whoever is running the
 * Issues hour drives this, and that is not always the person the team doc
 * calls leader.
 */
export async function setVotingOpen(
  teamId: string,
  meetingId: string,
  open: boolean,
) {
  const { db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "meetings", meetingId, teamId);
  await db
    .collection("meetings")
    .doc(meetingId)
    .update({ voting_open: open });
}

// Group-transport action — ending the meeting is the driver's call (Finish),
// gated the same way as advanceSegment. Nobody else in the room can close it
// out from under them without taking the wheel first, which is visible.
export async function endMeeting(teamId: string, meetingId: string) {
  const { uid, db, isAdmin } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, "meetings", meetingId, teamId);
  // Transactional so a second Finish (two people, or a stale tab) can't
  // overwrite ended_at and inflate the recorded duration.
  const ref = db.collection("meetings").doc(meetingId);
  const outcome = await db.runTransaction(
    async (tx): Promise<"ended" | "already-ended" | "not-driver"> => {
      const snap = await tx.get(ref);
      if (snap.data()?.ended_at != null) return "already-ended";
      // Same read-inside-the-transaction rule as advanceSegment, same no-op.
      // No claim on the way out: attributing an unclaimed legacy meeting to
      // whoever closed it would be a fiction, and there is no stage left to
      // drive.
      if (
        !canDrive({
          driverId: (snap.data()?.driver_id as string | null) ?? null,
          uid,
          isAdmin,
        })
      ) {
        return "not-driver";
      }
      tx.update(ref, {
        current_segment: "done",
        ended_at: FieldValue.serverTimestamp(),
      });
      return "ended";
    },
  );

  // Someone took the wheel a beat before this Finish landed. The meeting is
  // still live, so the recap redirect below would open a recap over a room
  // that hasn't ended — re-render the rail instead, which now shows who has
  // the wheel.
  if (outcome === "not-driver") {
    revalidatePath(detailPath(teamId, meetingId));
    redirect(detailPath(teamId, meetingId));
  }
  const didEnd = outcome === "ended";

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
  const meetingSnap = await requireTeamDoc(db, "meetings", meetingId, teamId);
  if (meetingSnap.data()?.ended_at != null) {
    throw new Error("Meeting notes cannot be edited after the meeting ends.");
  }
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
  const meetingSnap = await requireTeamDoc(db, "meetings", meetingId, teamId);
  const rating = Number(formData.get("rating"));
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
    throw new Error("Rating must be 1–10");
  }
  const scoreRef = db
    .collection("meetings")
    .doc(meetingId)
    .collection("effectiveness_scores")
    .doc(uid);
  const existing = await scoreRef.get();
  const meetingEnded = meetingSnap.data()?.ended_at != null;
  if (
    !ratingWriteAllowed({
      meetingEnded,
      alreadyRated: existing.exists,
    })
  ) {
    throw new Error(RATING_LOCKED_MESSAGE);
  }
  const notes = String(formData.get("notes") ?? "").trim() || null;
  await scoreRef.set({
    user_id: uid,
    rating: Math.round(rating),
    notes,
    created_at: existing.data()?.created_at ?? FieldValue.serverTimestamp(),
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
  const meetingSnap = await requireTeamDoc(db, "meetings", meetingId, teamId);
  if (meetingSnap.data()?.ended_at != null) {
    throw new Error("Attendance is frozen once the meeting has concluded.");
  }
  const ref = db.collection("meetings").doc(meetingId);
  await ref.update({
    absent_user_ids: absent
      ? FieldValue.arrayUnion(userId)
      : FieldValue.arrayRemove(userId),
  });
  revalidatePath(detailPath(teamId, meetingId));
}

// Leader/admin only. Destroying a team's meeting history (and, for a live
// meeting, the room everyone is sitting in) is not the same kind of act as
// driving one, so opening Start to every member does not open this with it.
export async function deleteMeeting(teamId: string, meetingId: string) {
  const { db } = await requireTeamLeader(teamId);
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

// ---------------------------------------------------------------------------
// Meeting settings (moved here from the team Members page)
// ---------------------------------------------------------------------------

/**
 * Durable L10 speaking order on the team. Leaders only (or org admin).
 * Must be a full permutation of the current roster.
 */
export async function setTeamSpeakingOrder(teamId: string, uids: string[]) {
  const { db } = await requireTeamLeader(teamId);
  const members = await getTeamMembers(teamId);
  const memberIds = new Set(members.map((m) => m.user_id));
  const unique = new Set(uids);
  const isPermutation =
    uids.length === members.length &&
    unique.size === uids.length &&
    uids.every((uid) => memberIds.has(uid));
  if (!isPermutation) throw new Error("Invalid speaking order");

  await db.collection("teams").doc(teamId).update({ speaking_order: uids });
  revalidatePath(`/teams/${teamId}/meetings`);
}

// Save the team's standing Google Meet URL used by the live-meeting Join
// button. DEMO: a leader pastes a Meet link here. In the real integration this
// is where the Meet REST API `spaces.create` would mint a per-meeting link at
// meeting start instead of a fixed team-level URL. Leaders only.
export async function setMeetLink(teamId: string, formData: FormData) {
  const { db } = await requireTeamLeader(teamId);
  const raw = String(formData.get("meet_link") ?? "").trim();

  // Accept a Meet URL or a blank (to clear). Reject anything that isn't a
  // Google Meet link so the Join button can't be pointed at arbitrary hosts.
  let meetLink: string | null = null;
  if (raw) {
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      throw new Error("Enter a valid URL");
    }
    if (host !== "meet.google.com") {
      throw new Error("Link must be a meet.google.com URL");
    }
    meetLink = raw;
  }

  await db
    .collection("teams")
    .doc(teamId)
    .set({ meet_link: meetLink }, { merge: true });
  revalidatePath(`/teams/${teamId}/meetings`);
}
