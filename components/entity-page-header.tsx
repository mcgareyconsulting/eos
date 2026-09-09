import { cn } from "@/lib/utils";

/**
 * Geometry every page-header control shares: 32px tall, 12px side padding,
 * 6px icon gap, `text-sm`, `font-medium`.
 *
 * **Height is fixed, not derived from padding.** The drift this replaces came
 * entirely from `py-1.5`: on a borderless button it computes to 32px, and on a
 * bordered one to 34px, so filled and outlined controls standing side by side
 * in the same row disagreed by two pixels and their labels sat off each
 * other's baseline. Two pixels nobody can name and everybody can see.
 */
export const entityHeaderControlBase =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium focus:outline-none focus-visible:ring-2";

/**
 * Shared add-button chrome so Rock / To-do / Issue / Headline triggers match.
 *
 * The `min-w` is what keeps the right edge of every page's header on the same
 * pixel regardless of whether the label reads "Add Rock" or "Add measurable".
 *
 * **Sized for the longest label, and `whitespace-nowrap` above enforces it.**
 * At 9.25rem the widest trigger — "Add measurable", which also carries a
 * chevron for its menu — wrapped to two lines, and two lines cannot sit in a
 * 32px control: the text overflowed the button and pushed the row out of the
 * alignment every other rule here exists to hold. Nowrap turns a future
 * too-long label into visible overflow rather than a silently broken row, so
 * it is obvious that this number needs raising again.
 *
 * **Keep in lockstep with the `add` column in the grid below** — they are the
 * same measurement written twice, and a mismatch reintroduces the wrap.
 */
export const entityAddButtonClass = `${entityHeaderControlBase} min-w-[11rem] bg-hpb-blue text-white hover:brightness-110 focus-visible:ring-hpb-blue/40`;

/**
 * The secondary control beside it — outlined rather than filled.
 *
 * Exists because there was no secondary counterpart, so every page that needed
 * one reached for `Button variant="outline"`, whose `py-1.5` plus a 1px border
 * measures **34px against the 32px** of everything else in the row. Two pixels
 * is invisible on its own and unmissable in a line of four controls: the
 * outlined one sits proud and the baseline of its label misses. `h-8` here
 * fixes the height rather than deriving it from padding, which is the only way
 * a bordered and an unbordered control can agree.
 *
 * No `min-w`: these are labelled by their own text and sit left of the
 * fixed-width tab and add slots, so pinning a width would only add a gap.
 */
export const entityHeaderButtonClass = `${entityHeaderControlBase} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 focus-visible:ring-hpb-blue/40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`;

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
          // The last column matches `entityAddButtonClass`'s min-w — see there.
          "grid-cols-[max-content_9rem_max-content_11rem]",
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
