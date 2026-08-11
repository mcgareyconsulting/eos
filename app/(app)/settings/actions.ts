"use server";

import { revalidatePath } from "next/cache";
import { requireFirebaseUser } from "@/lib/firebase/auth";
import {
  clearConnection,
  pullCompletionsForOwner,
} from "@/lib/google/tasks";

export async function disconnectGoogleTasks(): Promise<void> {
  const user = await requireFirebaseUser();
  await clearConnection(user.uid);
  revalidatePath("/settings");
}

/**
 * On-demand Google → EOS completion pull for the signed-in user.
 * Best-effort; never throws to the client form boundary as a hard error.
 */
export async function syncGoogleTasksNow(): Promise<{ updated: number }> {
  const user = await requireFirebaseUser();
  const result = await pullCompletionsForOwner(user.uid);
  revalidatePath("/settings");
  revalidatePath("/home");
  // Team todo lists live under /teams/[id]/todos — revalidate broad path.
  revalidatePath("/teams", "layout");
  return result;
}
