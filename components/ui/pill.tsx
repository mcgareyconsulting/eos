import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type PillProps = HTMLAttributes<HTMLSpanElement>;

/** Small "already handled" style marker (e.g. a discussed headline, a closed-pending issue). */
export function Pill({ className, ...props }: PillProps) {
  return (
    <span
      className={cn(
        "rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400",
        className,
      )}
      {...props}
    />
  );
}
