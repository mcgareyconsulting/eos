"use server";

import { revalidatePath } from "next/cache";
import { loadUserNames } from "@/lib/firebase/user-names";
import { notFound } from "next/navigation";
import { FieldValue } from "firebase-admin/firestore";
import {
  getTeamMembers,
  requireTeamAccess,
  requireTeamDoc,
} from "@/lib/firebase/teams";
import { notify } from "@/lib/firebase/notifications";
import { recordActivity } from "@/lib/firebase/activity";
import { liveMeetingRoom } from "@/lib/firebase/meeting-room";
import { mentionedIds } from "@/lib/mentions";
import {
  commentRecipients,
  snippetOf,
  type NotificationEntityType,
} from "@/lib/notifications";

export type CommentEntityType = "issue" | "rock" | "todo";

const ENTITY_TYPES: CommentEntityType[] = ["issue", "rock", "todo"];

function parentCollection(
  type: CommentEntityType,
): "issues" | "rocks" | "todos" {
  switch (type) {
    case "issue":
      return "issues";
    case "rock":
      return "rocks";
    case "todo":
      return "todos";
  }
}

/**
 * Comment types that carry followers, and so fan out notifications and
 * write the activity trace. Rocks are not here yet: they have no
 * `follower_ids`, and their status history is a trace of its own that the
 * two have to be merged with first (see the rocks/milestones plan).
 */
function followable(type: CommentEntityType): NotificationEntityType | null {
  switch (type) {
    case "todo":
      return "todo";
    case "issue":
      return "issue";
    case "rock":
      return null;
  }
}

/** Fallback title for a row whose entity has none. */
function fallbackTitle(type: NotificationEntityType): string {
  return type === "issue" ? "Issue" : "To-do";
}

/**
 * Append a free-form comment on an issue, rock or to-do. The body may carry
 * the same markdown subset as description fields (see lib/rich-text.ts) —
 * bold, bullets, links — and is stored verbatim as plain text; rendering, and
 * the https/mailto href allowlist, happen at read time. Binary attachments are
 * still out of scope; a link to a Doc is the substitute.
 *
 * To-do and issue comments additionally resolve `@Name` mentions against the
 * team roster (lib/mentions.ts) and fan out in-app notifications: mentioned
 * people get a `mention` row, every other follower gets a `comment` row.
 * Rocks carry no followers yet, so nothing is written for them.
 */
export async function addEntityComment(
  teamId: string,
  entityType: CommentEntityType,
  entityId: string,
  formData: FormData,
) {
  if (!ENTITY_TYPES.includes(entityType)) throw new Error("Bad entity type");
  const { uid, db, team, isAdmin } = await requireTeamAccess(teamId);
  // A rock has ONE thread, filed under its parent team, open to everyone
  // with the whole rock (lib/rocks-share.ts hasFullRockView) — including an
  // assignee posting from their own team's page, where `teamId` is not the
  // rock's team. Other entities stay team-scoped.
  const parent =
    entityType === "rock"
      ? await requireRockThreadAccess(db, entityId, teamId, uid, isAdmin)
      : await requireTeamDoc(db, parentCollection(entityType), entityId, teamId);
  const threadTeamId =
    entityType === "rock" ? String(parent.data()?.team_id ?? teamId) : teamId;

  // A private to-do is its owner's alone — the same test the todos rule and
  // the To-Dos page apply to reading it, applied here to writing under it.
  if (
    entityType === "todo" &&
    parent.data()?.visibility === "private" &&
    String(parent.data()?.owner_id ?? "") !== String(uid)
  ) {
    notFound();
  }

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Comment required");
  if (body.length > 4000) throw new Error("Comment too long (max 4000 chars)");

  const traced = followable(entityType);

  // Mentions ride with followers: only a followable entity has anyone to
  // tell, so only its comments resolve `mention_ids`.
  const members = traced
    ? (await getTeamMembers(teamId)).map((m) => ({
        id: m.user_id,
        name: m.full_name,
      }))
    : [];
  const mention_ids = mentionedIds(body, members);

  await db.collection("entity_comments").add({
    team_id: threadTeamId,
    entity_type: entityType,
    entity_id: entityId,
    body,
    author_id: uid,
    mention_ids,
    created_at: FieldValue.serverTimestamp(),
  });

  if (traced) {
    const data = parent.data() ?? {};
    const { mention, comment } = commentRecipients({
      followerIds: data.follower_ids as string[] | undefined,
      mentionedIds: mention_ids,
      actorId: uid,
      visibility: data.visibility as string | undefined,
      ownerId: data.owner_id as string | null | undefined,
      inRoomIds: await liveMeetingRoom(db, teamId),
    });
    const entity = {
      type: traced,
      id: entityId,
      title: String(data.title ?? fallbackTitle(traced)),
    };
    const detail = snippetOf(body);
    const teamRef = { id: teamId, name: team.name };
    await notify({
      db,
      recipientIds: mention,
      kind: "mention",
      team: teamRef,
      entity,
      actor: { id: uid },
      detail,
    });
    await notify({
      db,
      recipientIds: comment,
      kind: "comment",
      team: teamRef,
      entity,
      actor: { id: uid },
      detail,
    });
    await recordActivity({
      db,
      teamId,
      entity: {
        type: traced,
        id: entityId,
        visibility: data.visibility as string | undefined,
        ownerId: data.owner_id as string | null | undefined,
      },
      kind: "commented",
      actor: { id: uid },
      detail,
    });
  }

  revalidatePath(`/teams/${teamId}/issues`);
  revalidatePath(`/teams/${teamId}/rocks`);
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath(`/teams/${teamId}/meetings`);
  if (threadTeamId !== teamId) {
    revalidatePath(`/teams/${threadTeamId}/rocks`);
    revalidatePath(`/teams/${threadTeamId}/meetings`);
  }
}

/**
 * The rock behind a comment, for a caller viewing from `teamId` — parent
 * team, a team it is shared with, the rock's owner, an assignee, or admin.
 * Mirrors the `rockFullAccess` rule; the Admin SDK bypasses rules, so this
 * is the gate.
 */
async function requireRockThreadAccess(
  db: FirebaseFirestore.Firestore,
  rockId: string,
  teamId: string,
  uid: string,
  isAdmin: boolean,
) {
  const snap = await db.collection("rocks").doc(rockId).get();
  const rock = snap.data();
  if (!snap.exists || !rock) notFound();
  const shared = (rock.shared_team_ids as string[] | null) ?? [];
  const owners = (rock.milestone_owner_ids as string[] | null) ?? [];
  const ok =
    isAdmin ||
    rock.team_id === teamId ||
    shared.includes(teamId) ||
    rock.owner_id === uid ||
    owners.includes(uid);
  if (!ok) notFound();
  return snap;
}

/**
 * Names for comment authors the viewer's roster doesn't hold — a rock's
 * thread is one thread across teams, so its authors aren't all on the
 * roster of whichever page it is read from.
 */
export async function loadCommentAuthorNames(
  teamId: string,
  ids: string[],
): Promise<Record<string, string>> {
  const { db } = await requireTeamAccess(teamId);
  const names = await loadUserNames(db, [...new Set(ids)].slice(0, 100));
  return Object.fromEntries(names);
}

export async function deleteEntityComment(
  teamId: string,
  commentId: string,
) {
  const { uid, db } = await requireTeamAccess(teamId);
  const ref = db.collection("entity_comments").doc(commentId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Comment not found");
  const data = snap.data()!;
  // A rock's thread is read from any team that has the rock, so its
  // team_id is the rock's, not necessarily the caller's; the author check
  // below is what protects it.
  if (data.entity_type !== "rock" && data.team_id !== teamId) {
    throw new Error("Comment not found");
  }
  // Author can delete their own; leaders aren't special-cased here (keep simple).
  if (data.author_id !== uid) {
    throw new Error("Only the author can delete this comment");
  }
  await ref.delete();
  // The trace keeps a record of the deletion; the row that carried the body
  // is gone, but the snippet on the trace says what it was.
  const traced = ENTITY_TYPES.includes(data.entity_type)
    ? followable(data.entity_type as CommentEntityType)
    : null;
  if (traced) {
    const parent = await db
      .collection(parentCollection(traced))
      .doc(String(data.entity_id ?? ""))
      .get();
    const p = parent.data() ?? {};
    await recordActivity({
      db,
      teamId,
      entity: {
        type: traced,
        id: String(data.entity_id ?? ""),
        visibility: p.visibility as string | undefined,
        ownerId: p.owner_id as string | null | undefined,
      },
      kind: "comment_deleted",
      actor: { id: uid },
      detail: snippetOf(String(data.body ?? "")),
    });
  }
  revalidatePath(`/teams/${teamId}/issues`);
  revalidatePath(`/teams/${teamId}/rocks`);
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath(`/teams/${teamId}/meetings`);
}
