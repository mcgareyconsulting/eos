"use client";

import { useTransition } from "react";
import { Loader2, RefreshCw, Unplug } from "lucide-react";
import {
  disconnectGoogleTasks,
  syncGoogleTasksNow,
} from "./actions";

export function GoogleTasksActions({ connected }: { connected: boolean }) {
  const [syncPending, startSync] = useTransition();
  const [disconnectPending, startDisconnect] = useTransition();
  const busy = syncPending || disconnectPending;

  if (!connected) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          startSync(async () => {
            await syncGoogleTasksNow();
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {syncPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden />
        )}
        {syncPending ? "Syncing…" : "Sync now"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (
            !confirm(
              "Disconnect Google Tasks? EOS will stop pushing and pulling until you connect again. Existing tasks in Google are left as-is.",
            )
          ) {
            return;
          }
          startDisconnect(async () => {
            await disconnectGoogleTasks();
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {disconnectPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Unplug className="h-4 w-4" aria-hidden />
        )}
        {disconnectPending ? "Disconnecting…" : "Disconnect"}
      </button>
    </div>
  );
}
