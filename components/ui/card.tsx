import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type CardProps = HTMLAttributes<HTMLElement> & {
  /** divide-y row-list variant, for cards that are just a stack of rows. */
  divided?: boolean;
  /** Underlying element. Defaults to "div"; some call sites need "section". */
  as?: "div" | "section";
};

export const Card = forwardRef<HTMLElement, CardProps>(
  ({ className, divided = false, as = "div", ...props }, ref) => {
    const Comp = as;
    return (
      <Comp
        ref={ref as never}
        className={cn(
          divided
            ? "rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800"
            : "rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900",
          className,
        )}
        {...props}
      />
    );
  },
);
Card.displayName = "Card";
