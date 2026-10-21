"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ModalBody, ModalHeader, ModalShell } from "@/components/ui/modal";
import { NO_ACCESS_TEXT, itemNoun } from "@/lib/notifications";
import type { ItemPeek } from "@/lib/firebase/item-peek";
import { loadItemPeek } from "./actions";
import type { NotificationRow } from "./notifications-hub";

/**
 * A notification's item (rock, issue, metric, headline), opened in place:
 * title + snippet rendered at open time through `canSee` (spec §5.3), or
 * NO_ACCESS_TEXT. To-dos and milestones use TodoPeekModal instead.
 */
export function ItemPeekModal({
  n,
  onClose,
}: {
  n: NotificationRow;
  onClose: () => void;
}) {
  const [peek, setPeek] = useState<ItemPeek | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    loadItemPeek({ type: n.entity_type, id: n.entity_id })
      .then((p) => {
        if (!cancelled) setPeek(p);
      })
      .catch((e) => {
        console.error("[notifications] peek load failed:", e);
        if (!cancelled) setPeek({ access: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [n.entity_type, n.entity_id]);

  const ok = peek !== "loading" && peek.access === "ok" ? peek : null;
  const noun = itemNoun(n.entity_type);

  return (
    <ModalShell open onClose={onClose} ariaLabel="Item" size="lg" portal>
      <ModalHeader
        onClose={onClose}
        title={
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">
              {ok?.title || noun.replace(/^an? /, "").replace(/^./, (c) => c.toUpperCase())}
            </h2>
            {ok && <p className="text-[11px] text-zinc-500">{ok.teamName}</p>}
          </div>
        }
      />
      <ModalBody>
        {peek === "loading" && (
          <p className="py-6 text-center text-sm text-zinc-500">Loading…</p>
        )}
        {peek !== "loading" && peek.access === "none" && (
          <p className="py-6 text-center text-sm text-zinc-500">{NO_ACCESS_TEXT}</p>
        )}
        {ok && (
          <>
            {ok.snippet ? (
              <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
                {ok.snippet}
              </p>
            ) : (
              <p className="text-sm text-zinc-500">No description.</p>
            )}
            <Link
              href={ok.href}
              className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open {noun.replace(/^an? /, "")}
            </Link>
          </>
        )}
      </ModalBody>
    </ModalShell>
  );
}
