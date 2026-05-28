"use client";

import { useTransition } from "react";
import { Check, X } from "lucide-react";
import { setIssueStatus } from "./actions";

export function StatusActions({
  teamId,
  issueId,
  status,
}: {
  teamId: string;
  issueId: string;
  status: string;
}) {
  const [pending, start] = useTransition();

  if (status === "solved" || status === "dropped") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setIssueStatus(teamId, issueId, "open");
          })
        }
        className="text-xs text-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-50"
      >
        Reopen
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setIssueStatus(teamId, issueId, "solved");
          })
        }
        title="Mark solved"
        className="rounded p-1 text-zinc-500 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 dark:hover:bg-emerald-950 dark:hover:text-emerald-300"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setIssueStatus(teamId, issueId, "dropped");
          })
        }
        title="Drop"
        className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
