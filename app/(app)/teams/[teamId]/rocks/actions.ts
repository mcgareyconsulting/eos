"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const STATUSES = ["on_track", "off_track", "done", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

export async function addRock(teamId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const quarter = String(formData.get("quarter") ?? "").trim();
  const due_date = String(formData.get("due_date") ?? "").trim() || null;
  const owner_id = String(formData.get("owner_id") ?? "") || null;
  const description = String(formData.get("description") ?? "").trim() || null;

  if (!title || !quarter) throw new Error("Title and quarter required");

  const supabase = await createClient();
  const { error } = await supabase.from("rocks").insert({
    team_id: teamId,
    title,
    quarter,
    due_date,
    owner_id,
    description,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/teams/${teamId}/rocks`);
}

export async function setRockStatus(
  teamId: string,
  rockId: string,
  status: string,
) {
  if (!STATUSES.includes(status as Status)) throw new Error("Bad status");
  const supabase = await createClient();
  await supabase.from("rocks").update({ status }).eq("id", rockId);
  revalidatePath(`/teams/${teamId}/rocks`);
}

export async function deleteRock(teamId: string, rockId: string) {
  const supabase = await createClient();
  await supabase.from("rocks").delete().eq("id", rockId);
  revalidatePath(`/teams/${teamId}/rocks`);
}
