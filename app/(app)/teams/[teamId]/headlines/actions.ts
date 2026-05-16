"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addHeadline(teamId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim() || null;
  const kind = String(formData.get("kind") ?? "customer");

  if (!title) throw new Error("Title required");
  if (kind !== "customer" && kind !== "employee") {
    throw new Error("Invalid kind");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("headlines").insert({
    team_id: teamId,
    title,
    body,
    kind,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/teams/${teamId}/headlines`);
}

export async function deleteHeadline(teamId: string, id: string) {
  const supabase = await createClient();
  await supabase.from("headlines").delete().eq("id", id);
  revalidatePath(`/teams/${teamId}/headlines`);
}
