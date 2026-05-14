"use client";

import { useTransition } from "react";
import { setRockStatus } from "./actions";
import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  on_track: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  off_track: "bg-amber-50 text-amber-700 ring-amber-200",
  done: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  cancelled: "bg-zinc-50 text-zinc-500 ring-zinc-200",
};

export function StatusSelect({
  teamId,
  rockId,
  status,
}: {
  teamId: string;
  rockId: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          await setRockStatus(teamId, rockId, e.target.value);
        })
      }
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset focus:outline-none cursor-pointer",
        STYLES[status] ?? STYLES.on_track,
      )}
    >
      <option value="on_track">On track</option>
      <option value="off_track">Off track</option>
      <option value="done">Done</option>
      <option value="cancelled">Cancelled</option>
    </select>
  );
}
