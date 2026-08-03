"use client";

import { useTransition } from "react";
import { signOut as clientSignOut } from "firebase/auth";
import { getClientAuth } from "@/lib/firebase/client";
import { signOut as clearServerSession } from "@/app/(app)/sign-out-action";

/**
 * Clears *both* halves of auth: client Firebase Auth (live listeners) and
 * the HttpOnly session cookie (SSR). Server-only sign-out left client auth
 * signed in, so the next person on a shared machine could inherit a live
 * Firestore session under the previous Google account.
 */
export function SignOutButton({
  className,
  children = "Sign out",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      className={className}
      onClick={() => {
        start(async () => {
          try {
            await clientSignOut(getClientAuth());
          } catch {
            // Cookie clear still matters even if client auth was already gone.
          }
          await clearServerSession();
        });
      }}
    >
      {pending ? "Signing out…" : children}
    </button>
  );
}
