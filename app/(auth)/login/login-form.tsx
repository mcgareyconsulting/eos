"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup } from "firebase/auth";
import {
  getClientAuth,
  googleProvider,
} from "@/lib/firebase/client";
import { setSession } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    setBusy(true);
    try {
      const result = await signInWithPopup(getClientAuth(), googleProvider());
      const idToken = await result.user.getIdToken();
      const res = await setSession(idToken);
      if (!res.ok) {
        setError(res.error ?? "Sign-in failed.");
        setBusy(false);
        return;
      }
      router.push(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleSignIn}
        disabled={busy}
        className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-3"
      >
        <GoogleIcon />
        {busy ? "Signing in…" : "Sign in with Google"}
      </button>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950 px-3 py-2 text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44a5.5 5.5 0 0 1-2.39 3.6v3h3.85c2.25-2.08 3.59-5.14 3.59-8.84z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.85-3c-1.07.72-2.45 1.15-4.1 1.15-3.15 0-5.82-2.13-6.77-4.99H1.25v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.23 14.26A7.21 7.21 0 0 1 4.85 12c0-.78.14-1.54.38-2.26V6.64H1.25A12 12 0 0 0 0 12c0 1.94.46 3.77 1.25 5.36l3.98-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.31 2.69 1.25 6.64l3.98 3.1C6.18 6.88 8.85 4.75 12 4.75z"
      />
    </svg>
  );
}
