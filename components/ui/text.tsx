import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type EyebrowProps = HTMLAttributes<HTMLElement> & {
  /** text-[10px] (dt labels) vs text-sm (h2 section labels). */
  size?: "sm" | "md";
  /** Underlying element — callers pick the semantically correct tag (e.g. "dt", "h2"). */
  as: "dt" | "h2";
};

/** Small uppercase label used for both <dl> term labels and standalone section labels. */
export function Eyebrow({ className, size = "sm", as, ...props }: EyebrowProps) {
  const Comp = as;
  return (
    <Comp
      className={cn(
        size === "sm"
          ? "text-[10px] font-medium uppercase tracking-wide text-zinc-500"
          : "text-sm font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400",
        className,
      )}
      {...props}
    />
  );
}

export type SectionTitleProps = HTMLAttributes<HTMLElement> & {
  /** Underlying heading level — callers pick the semantically correct tag. */
  as: "h3" | "h4";
};

/** Compact group/section heading used in meeting L10 segments. */
export function SectionTitle({ className, as, ...props }: SectionTitleProps) {
  const Comp = as;
  return (
    <Comp
      className={cn(
        "text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200",
        className,
      )}
      {...props}
    />
  );
}
