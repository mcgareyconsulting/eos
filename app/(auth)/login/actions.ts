"use server";

import { createSession } from "@/lib/firebase/session";

export async function setSession(
  idToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createSession(idToken);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
