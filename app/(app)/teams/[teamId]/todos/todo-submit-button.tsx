"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

// Submit button for the add-todo form. Shows a spinner while the server action
// runs — which now includes the synchronous Google Tasks push, so the extra
// latency is visible feedback rather than a dead button. Must render inside the
// <form> for useFormStatus() to see its pending state.
export function AddTodoSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="md:col-span-6 md:justify-self-end inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:opacity-70"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {pending ? "Saving…" : "Add to-do"}
    </button>
  );
}
