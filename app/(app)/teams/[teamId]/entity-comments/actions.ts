"use server";

import { revalidatePath } from "next/cache";
import { loadUserNames } from "@/lib/firebase/user-names";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";
import { emitEvent } from "@/lib/firebase/notifications";
import { autoFollow } from "@/lib/firebase/follow";
import { recordActivity } from "@/lib/firebase/activity";
import { getDirectoryPeople } from "@/lib/firebase/directory";
import { blockedMentionMessage, resolveMentions } from "@/lib/mentions";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import {
  isThreadEntityType,
  loadThreadContext,
  mentionPeopleOf,
  requireThreadAccess,
  type ThreadContext,
} from "@/lib/firebase/thread-gate";
import { snippetOf } from "@/lib/notifications";

export type CommentEntityType = "issue" | "rock" | "todo" | "headline";

/**
 * Append a free-form comment on a rock, milestone, to-do, issue or headline.
 * The body may carry the same markdown subset as description fields (see
 * lib/rich-text.ts) — bold, bullets, links — and is stored verbatim as plain
 * text; rendering, and the https/mailto href allowlist, happen at read time.
 * Binary attachments are still out of scope; a link to a Doc is the
 * substitute.
 *
 * One path for every item type (spec §5.0): `requireThreadAccess` loads the
 * item through the registry and asks its access module (lib/firebase/
 * thread-gate.ts). `@Name` mentions resolve against the people who can see
 * the item (lib/mentions.ts), not the team roster; a comment that mentions
 * someone who cannot see it is refused, never silently trimmed (spec §5.2).
 * Mentioned people get a `mention` notification, every other follower a
 * `comment` one (emitEvent, access-checked again at send time). The author
 * and the mentioned people auto-follow the item.
 *
 * `teamId` is only the page the comment was posted from; the thread is filed
 * under the item's own team.
 */
export async function addEntityComment(
  teamId: string,
  entityType: CommentEntityType,
  entityId: string,
  formData: FormData,
) {
  if (!isThreadEntityType(entityType)) throw new Error("Bad entity type");
  const gate = await requireThreadAccess(entityType, entityId);
  const { uid, db, item } = gate;
  const threadTeamId = gate.teamId || teamId;

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Comment required");
  if (body.length > 4000) throw new Error("Comment too long (max 4000 chars)");

  // The directory is only read when the body can carry a mention.
  let mention_ids: string[] = [];
  if (body.includes("@")) {
    const people = mentionPeopleOf(item, await getDirectoryPeople(gate.isAdmin));
    const { ids, blocked } = resolveMentions(body, people);
    if (blocked.length > 0) throw new Error(blockedMentionMessage(blocked));
    mention_ids = ids;
  }

  await db.collection("entity_comments").add({
    team_id: threadTeamId,
    entity_type: entityType,
    entity_id: entityId,
    body,
    author_id: uid,
    mention_ids,
    created_at: FieldValue.serverTimestamp(),
  });

  // Spec §5.3: writing a comment, or being mentioned in one, follows the
  // item (only people who may follow it — a mention never grants access).
  const ref = item.ref;
  await autoFollow(db, ref, [uid, ...mention_ids]);

  // Mentioned people get `mention`, every other follower `comment`; the
  // send-time access check drops anyone who cannot see the item.
  await emitEvent(db, ref, "comment", uid, {
    teamId: threadTeamId,
    direct: { mention: mention_ids },
  });

  if (entityType === "todo") {
    const data = item.data;
    await recordActivity({
      db,
      teamId: threadTeamId,
      entity: {
        type: "todo",
        id: entityId,
        visibility: data.visibility as string | undefined,
        ownerId: data.owner_id as string | null | undefined,
      },
      kind: "commented",
      actor: { id: uid },
      detail: snippetOf(body),
    });
  }

  revalidateThreadPages(teamId, threadTeamId);
}

function revalidateThreadPages(teamId: string, threadTeamId: string) {
  for (const t of new Set([teamId, threadTeamId])) {
    revalidatePath(`/teams/${t}/issues`);
    revalidatePath(`/teams/${t}/rocks`);
    revalidatePath(`/teams/${t}/todos`);
    revalidatePath(`/teams/${t}/headlines`);
    revalidatePath(`/teams/${t}/meetings`);
  }
}

/**
 * What a comment box needs to know about its thread: who can be mentioned
 * (everyone, the people who cannot see the item flagged so the picker greys
 * them) and the "Visible to …" line.
 */
export async function loadThreadInfo(
  entityType: CommentEntityType,
  entityId: string,
): Promise<ThreadContext> {
  const gate = await requireThreadAccess(entityType, entityId);
  return loadThreadContext(gate);
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

/**
 * Delete a comment: its author or an admin, on every thread type. A thread is
 * read from any team that can see the item, so the comment's `team_id` is the
 * item's, not necessarily the caller's — the author check is the gate.
 */
export async function deleteEntityComment(
  teamId: string,
  commentId: string,
) {
  const { uid, db, isAdmin } = await requireFirebaseUser();
  const ref = db.collection("entity_comments").doc(commentId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Comment not found");
  const data = snap.data()!;
  if (data.author_id !== uid && !isAdmin) {
    throw new Error("Only the author or an admin can delete this comment");
  }
  await ref.delete();
  // The trace keeps a record of the deletion; the row that carried the body
  // is gone, but the snippet on the trace says what it was.
  if (data.entity_type === "todo") {
    const parent = await db
      .collection("todos")
      .doc(String(data.entity_id ?? ""))
      .get();
    const p = parent.data() ?? {};
    await recordActivity({
      db,
      teamId: String(data.team_id ?? teamId),
      entity: {
        type: "todo",
        id: String(data.entity_id ?? ""),
        visibility: p.visibility as string | undefined,
        ownerId: p.owner_id as string | null | undefined,
      },
      kind: "comment_deleted",
      actor: { id: uid },
      detail: snippetOf(String(data.body ?? "")),
    });
  }
  revalidateThreadPages(teamId, String(data.team_id ?? teamId));
}
