"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { addDays, toDateString } from "@/lib/dates";

export async function addIssue(teamId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const owner_id = String(formData.get("owner_id") ?? "") || null;
  const priority = clampPriority(Number(formData.get("priority") ?? 3));
  const type = String(formData.get("type") ?? "short");

  if (!title) throw new Error("Title required");

  const supabase = await createClient();
  const { error } = await supabase.from("issues").insert({
    team_id: teamId,
    title,
    description,
    owner_id,
    priority,
    type,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/teams/${teamId}/issues`);
}

export async function updateIssueTitle(
  teamId: string,
  issueId: string,
  title: string,
) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title required");
  const supabase = await createClient();
  const { error } = await supabase
    .from("issues")
    .update({ title: trimmed })
    .eq("id", issueId);
  if (error) throw new Error(error.message);
  revalidatePath(`/teams/${teamId}/issues`);
}

export async function setIssuePriority(
  teamId: string,
  issueId: string,
  priority: number,
) {
  const supabase = await createClient();
  await supabase
    .from("issues")
    .update({ priority: clampPriority(priority) })
    .eq("id", issueId);
  revalidatePath(`/teams/${teamId}/issues`);
}

export async function toggleIssueVote(teamId: string, issueId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: existing } = await supabase
    .from("issue_votes")
    .select("issue_id")
    .eq("issue_id", issueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("issue_votes")
      .delete()
      .eq("issue_id", issueId)
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("issue_votes")
      .insert({ issue_id: issueId, user_id: user.id });
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/teams/${teamId}/issues`);
}

export async function solveIssue(
  teamId: string,
  issueId: string,
  formData: FormData,
) {
  const resolutionTitle =
    String(formData.get("resolution") ?? "").trim() ||
    "Follow up on issue";
  const todoOwnerId = String(formData.get("todo_owner_id") ?? "") || null;

  const supabase = await createClient();

  const { data: todo, error: todoErr } = await supabase
    .from("todos")
    .insert({
      team_id: teamId,
      title: resolutionTitle,
      owner_id: todoOwnerId,
      due_date: toDateString(addDays(new Date(), 7)),
      visibility: "team",
      source_issue_id: issueId,
    })
    .select("id")
    .single();
  if (todoErr) throw todoErr;

  await supabase
    .from("issues")
    .update({
      status: "solved",
      resolved_at: new Date().toISOString(),
      resolution_todo_id: todo!.id,
    })
    .eq("id", issueId);

  revalidatePath(`/teams/${teamId}/issues`);
  revalidatePath(`/teams/${teamId}/todos`);
  revalidatePath("/my90");
}

export async function reopenIssue(teamId: string, issueId: string) {
  const supabase = await createClient();
  await supabase
    .from("issues")
    .update({ status: "open", resolved_at: null, resolution_todo_id: null })
    .eq("id", issueId);
  revalidatePath(`/teams/${teamId}/issues`);
}

export async function deleteIssue(teamId: string, issueId: string) {
  const supabase = await createClient();
  await supabase.from("issues").delete().eq("id", issueId);
  revalidatePath(`/teams/${teamId}/issues`);
}

function clampPriority(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}
