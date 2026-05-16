"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { error?: string; needsConfirmation?: boolean; alreadyRegistered?: boolean }
  | null;

function safeNext(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/my90";
}

export async function signIn(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: error.message };
  redirect(next);
}

export async function signUp(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  const fullName = `${firstName} ${lastName}`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, first_name: firstName, last_name: lastName },
    },
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) {
      return { error: "An account with that email already exists. Sign in instead.", alreadyRegistered: true };
    }
    return { error: error.message };
  }

  // Email confirmation is required on the project: user is created but no
  // session is returned. We don't redirect — surface a message instead.
  if (!data.session) {
    return {
      needsConfirmation: true,
      error:
        "Email confirmation is on for this project. Disable it in Supabase (Authentication → Sign In/Up → Email → Confirm email = off), or check your inbox for the confirmation link.",
    };
  }

  redirect(next);
}
