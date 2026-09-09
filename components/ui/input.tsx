import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// The three text-field fills used across forms: px-2 (compact, selects and
// the date input), px-3 (default), and px-3 with the bg-white focus-ring
// treatment used on a few standalone (non-modal) forms.
//
// **All of them are 32px tall, stated rather than inferred**, matching the
// button variants. They used to derive height from `py-1.5` plus a 1px border,
// landing at 34px — so every form row that put a field next to a button had a
// two-pixel step in it, and a filter row mixing the two never quite lined up.
// A field and a button only agree if both name the same height.
//
// `h-8` sits first so a call site can still override it (cn is tailwind-merge),
// which the few genuinely taller fields do.
const INPUT_SM = "h-8 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950";
const INPUT_MD = "h-8 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950";
const INPUT_MD_RING =
  "h-8 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900";

export type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size"
> & {
  /** px-2 vs px-3 padding. Defaults to "md". Shadows the native `size` attribute — no call site here uses it. */
  size?: "sm" | "md";
  /** Swaps in the bg-white + focus-ring fill instead of the default dark fill. */
  ring?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = "md", ring = false, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(ring ? INPUT_MD_RING : size === "sm" ? INPUT_SM : INPUT_MD, className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

// Selects only ever use the compact (px-2) fill in this app.
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(INPUT_SM, className)} {...props} />
  ),
);
Select.displayName = "Select";
