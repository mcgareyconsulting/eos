"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { addDays, toDateString } from "@/lib/dates";

export async function addTodo(teamId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const owner_id = String(formData.get("owner_id") ?? "") || null;
  const due_date =
    String(formData.get("due_date") ?? "").trim() ||
    toDateString(addDays(new Date(), 7));
  const visibility = String(formData.get("visibility") ?? "team");

  if (!title) throw new Error("Title required");

  const supabase = await createClient();
  const { error } = await supabase.from("todos").insert({
    team_id: teamId,
    title,
    owner_id,
    due_date,
    visibility,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath("/my90");
}

export async function toggleTodo(
  teamId: string,
  todoId: string,
  completed: boolean,
) {
  const supabase = await createClient();
  await supabase
    .from("todos")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", todoId);

  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath("/my90");
}

export async function deleteTodo(teamId: string, todoId: string) {
  const supabase = await createClient();
  await supabase.from("todos").delete().eq("id", todoId);
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath("/my90");
}
