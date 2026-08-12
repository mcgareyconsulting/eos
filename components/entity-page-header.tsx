import { cn } from "@/lib/utils";

/** Shared add-button chrome so Rock / To-do / Issue / Headline triggers match. */
export const entityAddButtonClass =
  "inline-flex h-8 min-w-[9.25rem] items-center justify-center gap-1.5 rounded-md bg-hpb-blue px-3 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40";

/**
 * Locked entity-tab header. Title stays left; the trailing grid is
 * right-aligned so Filter / Active / Archived / Add sit on the same
 * pixels on every page. Optional leading (Sync) grows left from Filter
 * and does not shift the other columns.
 */
export function EntityPageHeader({
  title,
  leading,
  filter,
  tabs,
  add,
}: {
  title: string;
  leading?: React.ReactNode;
  filter: React.ReactNode;
  tabs: React.ReactNode;
  add: React.ReactNode;
}) {
  return (
    <header className="flex h-10 items-center justify-between gap-4">
      <h1 className="w-40 shrink-0 text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      <div
        className={cn(
          "grid shrink-0 items-center justify-end gap-2",
          "grid-cols-[max-content_9rem_max-content_9.25rem]",
        )}
      >
        <div className="flex justify-end">{leading}</div>
        <div className="min-w-0">{filter}</div>
        <div>{tabs}</div>
        <div className="flex justify-end">{add}</div>
      </div>
    </header>
  );
}
