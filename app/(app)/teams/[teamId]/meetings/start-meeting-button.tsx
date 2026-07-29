"use client";

import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";

// Client wrapper purely for pending state: the server action does several
// Firestore round-trips before redirecting, and an un-disabled button invited
// double-click double-starts.
export function StartMeetingButton({
  action,
}: {
  action: () => Promise<void>;
}) {
  return (
    <form action={action}>
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40 disabled:opacity-60"
    >
      <Plus className="h-4 w-4" />
      {pending ? "Starting…" : "Start meeting"}
    </button>
  );
}
