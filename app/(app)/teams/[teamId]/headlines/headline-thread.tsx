"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { EntityComments } from "@/components/entity-comments";
import { cn } from "@/lib/utils";

type Member = { user_id: string; full_name: string };

/**
 * A headline's thread (spec §5.1), folded under the row until opened.
 * `?headline=<id>` (the link a notification carries, lib/item-registry.ts)
 * opens this one on arrival and scrolls to it.
 */
export function HeadlineThread({
  teamId,
  headlineId,
  userId,
  members,
}: {
  teamId: string;
  headlineId: string;
  userId: string;
  members: Member[];
}) {
  const linked = useSearchParams().get("headline") === headlineId;
  const [open, setOpen] = useState(linked);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (linked) ref.current?.scrollIntoView({ block: "center" });
  }, [linked]);

  return (
    <div ref={ref} className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
          open && "font-medium text-zinc-700 dark:text-zinc-200",
        )}
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        {open ? "Hide comments" : "Comments"}
      </button>
      {open && (
        <EntityComments
          teamId={teamId}
          entityType="headline"
          entityId={headlineId}
          userId={userId}
          members={members}
          composer="collapsed"
          className="pt-2"
        />
      )}
    </div>
  );
}
