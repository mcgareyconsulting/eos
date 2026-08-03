"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Submit button for server-action forms. Disables itself and shows pending
 * copy while the action runs so double-clicks can't create duplicate rows
 * (client-reported on Headlines — four copies from one multi-press).
 *
 * Must render inside the `<form>` that owns the action for useFormStatus()
 * to observe pending state.
 */
export function PendingSubmitButton({
  idleLabel,
  pendingLabel = "Saving…",
  className,
}: {
  idleLabel: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-70",
        className,
      )}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
