"use server";

import { revalidatePath } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireTeamAccess } from "@/lib/firebase/teams";

const KINDS = ["customer", "employee", "cascading"] as const;
type Kind = (typeof KINDS)[number];

function pathFor(teamId: string) {
  return `/teams/${teamId}/headlines`;
}

export async function addHeadline(teamId: string, formData: FormData) {
  const { uid, db } = await requireTeamAccess(teamId);

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim() || null;
  const kindRaw = String(formData.get("kind") ?? "customer");
  const kind: Kind = KINDS.includes(kindRaw as Kind)
    ? (kindRaw as Kind)
    : "customer";

  if (!title) throw new Error("Title required");

  await db.collection("headlines").add({
    team_id: teamId,
    title,
    body,
    kind,
    created_by: uid,
    target_team_ids: [],
    created_at: FieldValue.serverTimestamp(),
  });

  revalidatePath(pathFor(teamId));
}

export async function deleteHeadline(teamId: string, headlineId: string) {
  const { db } = await requireTeamAccess(teamId);
  await db.collection("headlines").doc(headlineId).delete();
  revalidatePath(pathFor(teamId));
}
