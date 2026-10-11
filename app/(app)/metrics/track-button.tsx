"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addExistingMetric } from "@/app/(app)/teams/[teamId]/scorecard/actions";

/** "Add to <team>" — tracks a public metric on one of the viewer's teams. */
export function TrackButton({
  teamId,
  teamName,
  metricId,
}: {
  teamId: string;
  teamName: string;
  metricId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              setError(null);
              await addExistingMetric(teamId, metricId);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {pending ? "Adding…" : `Add to ${teamName}`}
      </button>
      {error && <span className="mt-0.5 text-[11px] text-red-600">{error}</span>}
    </span>
  );
}
