import { cn } from "@/lib/utils";

/**
 * A titled card of rows — the shared board column behind Home and the To-Dos
 * tab (N24/N22).
 *
 * These were two components, `HomeColumn` and `BoardColumn`, copied from one
 * another and already diverged by the time the 2026-08-26 audit found them:
 * one scrolled internally and took `flush`, the other deliberately did not
 * scroll and took `meta`. Both behaviours were right for their surface, which
 * is why this takes props rather than picking a winner — the drift was having
 * two definitions of the same visual language, not the behaviours themselves.
 */
export function BoardColumn({
  title,
  count,
  meta,
  flush,
  scroll,
  children,
}: {
  title: string;
  count: number;
  /** Optional breakdown (e.g. "5 open") when `count` alone under-explains. */
  meta?: string;
  /** Skip divide-y — a child (the rocks table) manages its own grid/header. */
  flush?: boolean;
  /**
   * Scroll inside the card instead of with the page.
   *
   * Home wants this: its columns are independent lists and an over-long one
   * shouldn't push the others off screen. The To-Dos tab deliberately does not
   * — the page scrolls as one so its two columns can't drift out of sync under
   * the reader.
   */
  scroll?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.07em] text-zinc-500 dark:text-zinc-400">
        {title} <span className="font-bold text-zinc-400">({count})</span>
        {meta && (
          <span className="ml-1.5 font-medium normal-case tracking-normal text-zinc-400">
            · {meta}
          </span>
        )}
      </h2>
      {/* Both scroll modes clip: a tinted first child (an owner header) would
          otherwise paint square over the rounded top corners — the bug found
          three times over on 2026-08-26. */}
      <div
        className={cn(
          "rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900",
          scroll
            ? "max-h-[min(70vh,40rem)] overflow-y-auto"
            : "overflow-hidden",
          !flush && "divide-y divide-zinc-100 dark:divide-zinc-800",
        )}
      >
        {children}
      </div>
    </section>
  );
}
