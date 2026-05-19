"use client";

import { useTransition } from "react";
import { AlertCircle } from "lucide-react";

export function DropToIssuesButton({
  title,
  description,
  dropAction,
  compact = false,
}: {
  title: string;
  description?: string;
  dropAction: (title: string, description?: string) => Promise<unknown>;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await dropAction(title, description); })}
      title="Add to the IDS list for this meeting"
      className={
        "inline-flex items-center gap-1 rounded-md text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950 disabled:opacity-50 " +
        (compact ? "px-1.5 py-0.5" : "px-2 py-1")
      }
    >
      <AlertCircle className="w-3.5 h-3.5" />
      {compact ? "Issue" : "Drop to Issues"}
    </button>
  );
}
