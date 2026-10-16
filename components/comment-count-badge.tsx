import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { commentCountLabel } from "@/lib/issue-comment-count";

/**
 * "This item has a thread" marker for a list row: a speech bubble and the
 * comment count. Renders nothing at 0, so a row only grows a badge once
 * someone has commented. Read-only — the thread opens from the item's detail.
 */
export function CommentCountBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  const label = commentCountLabel(count);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
        className,
      )}
      title={label}
    >
      <MessageSquare className="h-3 w-3" aria-hidden />
      <span aria-hidden>{count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
