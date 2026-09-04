import { cn } from "@/lib/utils";

/**
 * The "Weekly" pill (N50) — one definition, because it renders on three
 * surfaces with different layouts and a second copy is how the To-Dos tab and
 * Home end up disagreeing about what a weekly focus looks like. Same reasoning
 * that consolidated `BoardColumn` and `EntityViewTabs`.
 *
 * `align-middle` + `leading-none` rather than a hand-tuned nudge: in the
 * To-Dos row this sits in an inline flow beside a 14px title, where 10px
 * uppercase text sets its own baseline and lands low. Centring on the parent's
 * midline is stable at any title size. In Home's row the parent is a flex
 * container, which ignores `vertical-align` entirely and centres it anyway —
 * so the one component is correct in both without a per-surface variant.
 *
 * `shrink-0` matters on Home, where the sibling title is `truncate`: without
 * it the pill is the thing that gets squashed instead of the long title.
 */
export function WeeklyFocusPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-hpb-gold/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase leading-none tracking-wide text-hpb-brown ring-1 ring-inset ring-hpb-gold/40 dark:bg-hpb-gold/10 dark:text-hpb-gold",
        className,
      )}
      title="Weekly focus — the one to move this week"
    >
      Weekly
    </span>
  );
}
