/**
 * The To-Dos board's visual language — column, owner section, card, notice —
 * shared by the team To-Dos page (`todos-board.tsx`) and the L10 To-Dos stage
 * (`meetings/[meetingId]/segment-todos.tsx`). One definition so the two
 * surfaces cannot drift apart; the To-Dos page is the source of truth.
 *
 * Purely presentational: no hooks, no data. The sections are styled exactly
 * like the Rocks tab's (`RockSection` in rocks/page.tsx): a small uppercase
 * heading with its count, then a card of its own.
 */

/** One board column: a heading over a stack of owner sections. */
export function TodoColumn({
  title,
  count,
  meta,
  children,
}: {
  title: string;
  count: number;
  /** Optional breakdown (e.g. "5 open") when `count` alone under-explains. */
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-4">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
        {title} <span className="font-medium text-zinc-400">({count})</span>
        {meta && <span className="ml-1.5 font-medium text-zinc-400">· {meta}</span>}
      </h2>
      {children}
    </section>
  );
}

/** An owner's rows — the Rocks tab's section: heading, then its own card. */
export function OwnerSection({
  title,
  count,
  badge,
  dimmed,
  children,
}: {
  title: string;
  count: string;
  /** Optional status after the count (the L10's "Now speaking" / "Absent"). */
  badge?: React.ReactNode;
  /** Fade the whole section (an absent owner in the L10). */
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={dimmed ? "opacity-60" : undefined}>
      <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.07em] text-zinc-500 dark:text-zinc-400">
        {title} <span className="font-bold text-zinc-400">({count})</span>
        {badge}
      </h3>
      <SectionCard>{children}</SectionCard>
    </section>
  );
}

export function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </div>
  );
}

/** A one-line status under a column heading (e.g. "All to-dos done"). */
export function BoardNotice({ children }: { children: React.ReactNode }) {
  return <p className="text-center text-sm text-hpb-green">{children}</p>;
}

/** "Open · done" breakdown for an owner section's count. */
export function openDoneCount(open: number, done: number): string {
  return (
    [open > 0 ? `${open} open` : null, done > 0 ? `${done} done` : null]
      .filter(Boolean)
      .join(" · ") || "none"
  );
}
