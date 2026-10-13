"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { doc } from "firebase/firestore";
import { ChevronRight } from "lucide-react";
import { ActivityFeed } from "@/components/activity-feed";
import { RichText } from "@/components/rich-text";
import { getClientDb } from "@/lib/firebase/client";
import { useDoc } from "@/lib/firebase/use-collection";
import { cn } from "@/lib/utils";
import { emptyKeys, toggleKey, withDraft } from "./milestone-expand";

type Member = { user_id: string; full_name: string };
const NO_MEMBERS: Member[] = [];

/**
 * Which milestones on a surface are expanded. Any number may be open at once
 * — each toggles on its own, like the rock rows they sit under — so opening
 * one never hides another that is holding a half-typed comment.
 */
export function useExpandedMilestones() {
  const [open, setOpen] = useState(emptyKeys);
  const toggle = useCallback(
    (id: string) => setOpen((s) => toggleKey(s, id)),
    [],
  );
  return { isOpen: (id: string) => open.has(id), toggle };
}

/**
 * Which expanded milestones hold an unsent comment, for a host dialog's
 * discard guard (`hasDraft` → `useDiscardGuard`). `report` is stable.
 */
export function useMilestoneDrafts() {
  const [keys, setKeys] = useState(emptyKeys);
  const report = useCallback(
    (key: string, has: boolean) => setKeys((s) => withDraft(s, key, has)),
    [],
  );
  return { hasDraft: keys.size > 0, report };
}

/** The chevron that sits beside a milestone name it expands. */
export function ExpandChevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      className={cn(
        "h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform",
        open && "rotate-90",
      )}
      aria-hidden
    />
  );
}

/**
 * A milestone opened in place — the same panel on every surface that lists
 * milestones (rock detail, rock edit, the Rocks rows, the To-Dos and L10
 * milestone columns, Home): its description, then its ActivityFeed (the
 * milestone is a to-do, so the feed is the to-do thread and trace).
 *
 * - Read-only description by default; the rock edit modal passes its editor
 *   as `descriptionEditor` instead.
 * - No `milestoneId` (a row the rock save has not created yet): no feed,
 *   just a note — there is nothing to comment on until it exists.
 * - Mounted on first open and kept while collapsed, so folding a row away
 *   never drops a comment someone is typing; the host's discard guard still
 *   sees it (`onDraft`). Unmounting reports the draft gone.
 *
 * Commenting is the milestone's own rule (milestoneAccess.canComment, which
 * firestore.rules mirrors): everyone who can see the milestone. Every surface
 * that renders one is already gated by that, so `canComment` defaults on.
 */
export function MilestoneExpansion({
  open,
  draftKey,
  teamId,
  userId,
  members = NO_MEMBERS,
  milestoneId,
  description,
  descriptionEditor,
  canComment = true,
  onDraft,
  className,
}: {
  open: boolean;
  /** Identifies this panel to `onDraft` — the row key, stable for its life. */
  draftKey: string;
  /** The page it is shown from (comments file under the milestone's team). */
  teamId: string;
  userId: string;
  /** Roster for naming comment authors; the feed resolves the rest. */
  members?: Member[];
  /** Saved milestone (todo doc) id; absent for a row not created yet. */
  milestoneId?: string;
  /** `undefined` (not carried by the caller) = read live from the doc. */
  description?: string | null;
  /** Replaces the read-only description (rock edit modal). */
  descriptionEditor?: React.ReactNode;
  canComment?: boolean;
  onDraft?: (key: string, hasDraft: boolean) => void;
  className?: string;
}) {
  // Mount on first open, then stay (see above). Derived during render, the
  // React-documented way to adjust state to a prop change.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  const onDraftChange = useCallback(
    (has: boolean) => onDraft?.(draftKey, has),
    [onDraft, draftKey],
  );
  useEffect(() => () => onDraft?.(draftKey, false), [onDraft, draftKey]);

  if (!mounted) return null;
  return (
    <div hidden={!open} className={cn("space-y-4", className)}>
      <div>
        <h4 className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-zinc-400">
          Description
        </h4>
        {descriptionEditor ??
          (description === undefined && milestoneId ? (
            <LiveDescription milestoneId={milestoneId} />
          ) : (
            <DescriptionText value={description} />
          ))}
      </div>
      {milestoneId ? (
        <ActivityFeed
          teamId={teamId}
          entityType="todo"
          entityId={milestoneId}
          userId={userId}
          members={members}
          canComment={canComment}
          onDraftChange={onDraftChange}
        />
      ) : (
        <p className="text-[12px] italic text-zinc-400">
          Save the rock to comment on this milestone.
        </p>
      )}
    </div>
  );
}

function DescriptionText({ value }: { value: string | null | undefined }) {
  return value?.trim() ? (
    <RichText
      value={value}
      className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300"
    />
  ) : (
    <p className="text-[12.5px] italic text-zinc-400">No description</p>
  );
}

/**
 * The description read live from the milestone's own doc, for a surface
 * whose list does not carry it (the To-Dos board). The same to-do read rule
 * that let the row render gates this read; nothing subscribes until the
 * milestone is first opened (MilestoneExpansion mounts lazily).
 */
function LiveDescription({ milestoneId }: { milestoneId: string }) {
  const db = getClientDb();
  const ref = useMemo(() => doc(db, "todos", milestoneId), [db, milestoneId]);
  const live = useDoc<{ description?: string | null } | null>(
    ref,
    null,
    "milestone-description",
  );
  if (!live) {
    return <p className="text-[12.5px] italic text-zinc-400">Loading…</p>;
  }
  return <DescriptionText value={live.description} />;
}
