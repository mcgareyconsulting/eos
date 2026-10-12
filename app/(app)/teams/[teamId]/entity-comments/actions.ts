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
import { emitEvent } from "@/lib/firebase/notifications";
import { autoFollow } from "@/lib/firebase/follow";
import { recordActivity } from "@/lib/firebase/activity";
import { mentionedIds } from "@/lib/mentions";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import { requireTodoAccess } from "@/lib/firebase/todo-gate";
import { snippetOf } from "@/lib/notifications";

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
 * Append a free-form comment on an issue, rock or to-do. The body may carry
 * the same markdown subset as description fields (see lib/rich-text.ts) —
 * bold, bullets, links — and is stored verbatim as plain text; rendering, and
 * the https/mailto href allowlist, happen at read time. Binary attachments are
 * still out of scope; a link to a Doc is the substitute.
 *
 * To-do comments additionally resolve `@Name` mentions against the team
 * roster (lib/mentions.ts) and fan out in-app notifications: mentioned people
 * get a `mention` row, every other follower of the to-do gets a `comment`
 * row (lib/firebase/notifications.ts emitEvent, access-checked at send
 * time). The author and the mentioned people auto-follow the item, on every
 * thread type. Rock comments notify the rock's followers; issue comments
 * notify nobody yet (SPEC P9).
 */
export async function addEntityComment(
  teamId: string,
  entityType: CommentEntityType,
  entityId: string,
  formData: FormData,
) {
  if (!ENTITY_TYPES.includes(entityType)) throw new Error("Bad entity type");
  // A to-do (or milestone) thread is gated by the item, not the page
  // (P8a): an off-team assignee comments from their own team's page.
  const { uid, db, isAdmin } =
    entityType === "todo"
      ? await requireFirebaseUser()
      : await requireTeamAccess(teamId);
  // To-do and milestone threads: lib/firebase/todo-gate.ts — a team to-do's
  // parent team, assignee and admins; a private to-do's creator, assignee
  // and admins; a milestone's assignee, parent team, audience and admins.
  // Filed under the to-do's own team, whichever page posted it.
  const todoGate =
    entityType === "todo" ? await requireTodoAccess(entityId, "comment") : null;
  // A rock has ONE thread, filed under its parent team, open to everyone
  // with the whole rock (lib/access/rock.ts rockAccess.canComment) — including an
  // assignee posting from their own team's page, where `teamId` is not the
  // rock's team. Issues stay team-scoped.
  const parent =
    entityType === "rock"
      ? await requireRockThreadAccess(db, entityId, teamId, uid, isAdmin)
      : entityType === "todo"
        ? null
        : await requireTeamDoc(db, parentCollection(entityType), entityId, teamId);
  const threadTeamId =
    entityType === "rock"
      ? String(parent?.data()?.team_id ?? teamId)
      : todoGate
        ? todoGate.teamId || teamId
        : teamId;

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Comment required");
  if (body.length > 4000) throw new Error("Comment too long (max 4000 chars)");

  // Mentions are a to-do feature for now (the client asked for exactly that
  // scope), so only to-do comments carry `mention_ids`.
  const members =
    entityType === "todo"
      ? (await getTeamMembers(threadTeamId)).map((m) => ({
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

  // Spec §5.3: writing a comment, or being mentioned in one, follows the
  // item (only people who may follow it — a mention never grants access).
  const ref = { type: entityType, id: entityId };
  await autoFollow(db, ref, [uid, ...mention_ids]);

  if (entityType === "rock") {
    // Every follower of the rock hears a comment (spec §5.3); the send-time
    // check drops anyone who cannot see the rock.
    await emitEvent(db, ref, "comment", uid, { teamId: threadTeamId });
  }

  if (entityType === "todo") {
    const data = todoGate?.data ?? {};
    const detail = snippetOf(body);
    // Mentioned people get `mention`, every other follower `comment`; the
    // send-time access check drops anyone who cannot see the to-do.
    // SPEC P9: emit for issue / rock threads too.
    await emitEvent(db, ref, "comment", uid, {
      teamId: threadTeamId,
      direct: { mention: mention_ids },
    });
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
    if (entityType === "todo") revalidatePath(`/teams/${threadTeamId}/todos`);
  }
}

/**
 * The rock behind a comment. One thread per rock, open to everyone with the
 * full rock — the parent team, the audience (teams and persons) and admins
 * (lib/access/rock.ts `rockAccess.canComment`), judged on the caller's full
 * memberships; `teamId` is only the page it was posted from. A milestone
 * assignee outside that set, or someone who sees the rock in a block, has
 * no thread access. The Admin SDK bypasses rules, so this is the gate.
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
  const { rockAccess, rockSubjectOf } = await import("@/lib/access/rock");
  const { loadViewer } = await import("@/lib/firebase/viewer");
  const viewer = await loadViewer(db, uid, isAdmin);
  if (!rockAccess.canComment(rockSubjectOf(rock), viewer)) notFound();
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
  const { uid, db } = await requireFirebaseUser();
  const ref = db.collection("entity_comments").doc(commentId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Comment not found");
  const data = snap.data()!;
  // A rock's thread is read from any team that has the rock, and a to-do's
  // from any team its assignee is on (P8a), so their team_id is the item's,
  // not necessarily the caller's; the author check below is what protects
  // them. Issue threads stay team-scoped.
  if (data.entity_type === "issue") {
    await requireTeamAccess(teamId);
    if (data.team_id !== teamId) throw new Error("Comment not found");
  }
  // Author can delete their own; leaders aren't special-cased here (keep simple).
  if (data.author_id !== uid) {
    throw new Error("Only the author can delete this comment");
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
  revalidatePath(`/teams/${teamId}/issues`);
  revalidatePath(`/teams/${teamId}/rocks`);
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath(`/teams/${teamId}/meetings`);
}
