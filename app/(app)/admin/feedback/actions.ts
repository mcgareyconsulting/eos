"use server";

import { revalidatePath } from "next/cache";
import {
  createFeedbackCore,
  saveFeedbackEditsCore,
  setFeedbackStatusCore,
  type FeedbackCreateResult,
  type FeedbackSaveResult,
} from "./action-core";

// Feedback tracker actions (ROADMAP N73). Admin-only: the logic and the gate
// are ./action-core.ts → lib/firebase/feedback.ts (requireAdmin). This file
// only refreshes the pages after a write.

function revalidateFeedback(id?: string) {
  revalidatePath("/admin/feedback");
  if (id) revalidatePath(`/admin/feedback/${id}`);
}

/** Save the detail page's Edit form. */
export async function saveFeedbackEdits(id: string, form: unknown): Promise<FeedbackSaveResult> {
  const result = await saveFeedbackEditsCore(id, form);
  if (result.ok && result.changed.length > 0) revalidateFeedback(id);
  return result;
}

/** Change one item's status (the board's select). */
export async function setFeedbackStatus(id: string, status: unknown): Promise<FeedbackSaveResult> {
  const result = await setFeedbackStatusCore(id, status);
  if (result.ok && result.changed.length > 0) revalidateFeedback(id);
  return result;
}

/** Log a new item. */
export async function createFeedback(input: unknown): Promise<FeedbackCreateResult> {
  const result = await createFeedbackCore(input);
  if (result.ok) revalidateFeedback();
  return result;
}
