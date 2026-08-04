"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess, requireTeamDoc } from "@/lib/firebase/teams";

export type CommentEntityType = "issue" | "rock";

const ENTITY_TYPES: CommentEntityType[] = ["issue", "rock"];

function parentCollection(type: CommentEntityType): "issues" | "rocks" {
  return type === "issue" ? "issues" : "rocks";
}

/**
 * Append a free-form comment on an issue or rock.
 * Links in the body are fine (Google Docs etc.); binary attachments are out of scope.
 */
export async function addEntityComment(
  teamId: string,
  entityType: CommentEntityType,
  entityId: string,
  formData: FormData,
) {
  if (!ENTITY_TYPES.includes(entityType)) throw new Error("Bad entity type");
  const { uid, db } = await requireTeamAccess(teamId);
  await requireTeamDoc(db, parentCollection(entityType), entityId, teamId);

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Comment required");
  if (body.length > 4000) throw new Error("Comment too long (max 4000 chars)");

  await db.collection("entity_comments").add({
    team_id: teamId,
    entity_type: entityType,
    entity_id: entityId,
    body,
    author_id: uid,
    created_at: FieldValue.serverTimestamp(),
  });

  revalidatePath(`/teams/${teamId}/issues`);
  revalidatePath(`/teams/${teamId}/rocks`);
  revalidatePath(`/teams/${teamId}/meetings`);
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
  if (data.team_id !== teamId) throw new Error("Comment not found");
  // Author can delete their own; leaders aren't special-cased here (keep simple).
  if (data.author_id !== uid) {
    throw new Error("Only the author can delete this comment");
  }
  await ref.delete();
  revalidatePath(`/teams/${teamId}/issues`);
  revalidatePath(`/teams/${teamId}/rocks`);
  revalidatePath(`/teams/${teamId}/meetings`);
}
