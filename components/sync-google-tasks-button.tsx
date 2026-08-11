"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { syncGoogleTasksNow } from "@/app/(app)/settings/actions";
import { cn } from "@/lib/utils";

/**
 * On-demand Google Tasks → EOS completion pull. Works without Cloud Scheduler;
 * page load also pulls, but this lets the user force a refresh while staying
 * on To-Dos (or Settings).
 */
export function SyncGoogleTasksButton({
  connected,
  configured = true,
  className,
  showHint = true,
}: {
  /** User has OAuth tokens stored. */
  connected: boolean;
  /** GOOGLE_OAUTH_* present on this deployment. */
  configured?: boolean;
  className?: string;
  showHint?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  if (!configured) {
    return null;
  }

  if (!connected) {
    return (
      <Link
        href="/settings"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
          className,
        )}
        title="Connect Google Tasks in Settings to sync completions"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Connect Tasks
      </Link>
    );
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setNote(null);
          start(async () => {
            const result = await syncGoogleTasksNow();
            router.refresh();
            const n = result?.updated ?? 0;
            setNote(
              n === 0
                ? "No new completions from Google Tasks."
                : `Marked ${n} complete from Google Tasks (see Done).`,
            );
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        title="Pull completions from Google Tasks into EOS"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        )}
        {pending ? "Syncing…" : "Sync Google Tasks"}
      </button>
      {showHint && note && (
        <p className="max-w-[16rem] text-right text-[11px] text-zinc-500 dark:text-zinc-400">
          {note}
        </p>
      )}
    </div>
  );
}
