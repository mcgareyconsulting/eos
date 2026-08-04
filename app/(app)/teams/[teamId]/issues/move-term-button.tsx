"use client";

import { useTransition } from "react";
import { setIssueType } from "./actions";
import type { IssueType } from "@/lib/issues";

/** Move an issue between short-term and long-term. */
export function MoveIssueTermButton({
  teamId,
  issueId,
  type,
}: {
  teamId: string;
  issueId: string;
  type: IssueType | null | undefined;
}) {
  const [pending, start] = useTransition();
  const isLong = type === "long";
  const next: IssueType = isLong ? "short" : "long";
  // Destination + arrow (arrow sides unchanged; labels flipped from prior
  // "Short →" / "← Long"): leave short with Long →, return with ← Short.
  const label = isLong ? "← Short" : "Long →";
  const title = isLong ? "Move to short-term" : "Move to long-term";

  return (
    <button
      type="button"
      disabled={pending}
      title={title}
      aria-label={title}
      onClick={() =>
        start(async () => {
          await setIssueType(teamId, issueId, next);
        })
      }
      className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-zinc-500 opacity-0 hover:bg-zinc-100 hover:text-zinc-800 group-hover:opacity-100 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      {label}
    </button>
  );
}
