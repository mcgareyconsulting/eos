"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Unplug } from "lucide-react";
import { disconnectGoogleTasks } from "./actions";
import { SyncGoogleTasksButton } from "@/components/sync-google-tasks-button";

export function GoogleTasksActions({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [disconnectPending, startDisconnect] = useTransition();

  if (!connected) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <SyncGoogleTasksButton connected={connected} configured />
      <button
        type="button"
        disabled={disconnectPending}
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
            router.refresh();
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
