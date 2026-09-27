"use server";

import { redirect } from "next/navigation";
import { endSession } from "@/lib/firebase/session";

// Revokes the user's Firebase refresh tokens, then clears the cookie (C-05) —
// see endSession in lib/firebase/session.ts.
export async function signOut() {
  await endSession();
  redirect("/login");
}
