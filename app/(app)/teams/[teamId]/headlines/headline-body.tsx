import { cn } from "@/lib/utils";

/**
 * One-line preview of a headline's body on its row.
 *
 * Headlines carry the story in `body`, and an imported batch can run to
 * paragraphs each — rendering every one in full turned the list into a wall
 * of text you had to scroll past to find the next title. The row shows a
 * single clamped line so it still hints at its content; the whole text lives
 * in the headline detail modal (headline-detail-modal.tsx), which the row
 * opens. That replaced the inline expand toggle this used to carry.
 *
 * A span, not a div: it renders inside the row's HeadlineDetailTrigger
 * button. Callers render nothing when there is no body, so short headlines
 * keep their one-line shape.
 */
export function HeadlineBody({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mt-0.5 line-clamp-1 block min-w-0 text-sm text-zinc-600 dark:text-zinc-400",
        className,
      )}
    >
      {body}
    </span>
  );
}
