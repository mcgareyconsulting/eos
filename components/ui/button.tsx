import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Geometry shared by every variant: 32px tall, centred content.
 *
 * **Height is fixed rather than derived from padding**, which is the whole
 * repair. Each variant used to set `py-1.5` and let the box compute itself —
 * fine for `primary` and `ghost` at 32px, but `outline` adds a 1px border top
 * and bottom and came out at **34px**. So a Cancel beside a Save, or an
 * outlined control beside a filled one in any toolbar, sat two pixels out with
 * their labels off a shared baseline. Two pixels nobody can name and everybody
 * can see. A bordered and an unbordered control can only agree on height if
 * the height is stated, not inferred.
 *
 * `inline-flex` + `items-center` comes with it: without it a button holding an
 * icon aligns on the text baseline instead of the box, which reintroduces the
 * same drift by another route.
 */
const BASE = "inline-flex h-8 items-center justify-center rounded-md text-sm";

// Horizontal padding still differs by variant, and that is intentional — a
// primary action earns more room than the ghost beside it. Only the vertical
// metric has to match.
const VARIANT_CLASS = {
  primary:
    `${BASE} gap-1.5 bg-zinc-900 px-4 font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200`,
  ghost:
    `${BASE} gap-1.5 px-3 text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800`,
  outline:
    `${BASE} gap-1.5 border border-zinc-300 px-3 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800`,
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANT_CLASS;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(VARIANT_CLASS[variant], className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** text-zinc-500 + disabled:opacity-30, for reorder/step controls that can disable. */
  muted?: boolean;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, muted = false, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        muted
          ? "rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
          : "rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800",
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";
