"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

export type RecapItem = {
  id: string;
  title: string;
  owner_name?: string | null;
};

export type RecapAttendeeRating = {
  user_id: string;
  full_name: string;
  average: number | null;
  absent: boolean;
};

export type RecapStats = {
  totalTrackedIssues: number;
  issuesSolvedToday: number;
  solveRatePercent: number | null;
};

export function RecapModal({
  meetingMinutes,
  notes,
  newRocks,
  newTodos,
  newIssues,
  issuesSolved,
  newHeadlines,
  stats,
  attendeeRatings,
  autoOpen,
}: {
  meetingMinutes: number | null;
  notes: string | null;
  newRocks: RecapItem[];
  newTodos: RecapItem[];
  newIssues: RecapItem[];
  issuesSolved: RecapItem[];
  newHeadlines: RecapItem[];
  stats: RecapStats;
  attendeeRatings: RecapAttendeeRating[];
  autoOpen: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(autoOpen);

  // Re-sync with URL query so router-driven open (?recap=1) and our local
  // close (router.replace) stay aligned.
  useEffect(() => {
    setOpen(params.get("recap") === "1");
  }, [params]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    const sp = new URLSearchParams(params.toString());
    sp.delete("recap");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={close}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label="Past L10 condensed"
        className="absolute right-0 top-0 h-full w-full max-w-lg bg-white dark:bg-zinc-900 shadow-2xl border-l border-zinc-300 dark:border-zinc-800 flex flex-col"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-300 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold">Past L10 Condensed</h2>
            {meetingMinutes != null && (
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                {meetingMinutes} min meeting
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          <Section title="Rocks Created">
            <ItemList
              items={newRocks}
              empty="No Rocks were created during this Meeting"
            />
          </Section>

          <Section title="To-Dos Created">
            <ItemList
              items={newTodos}
              empty="No To-Dos were created during this Meeting"
            />
          </Section>

          <Section title="Issues Solved">
            <ItemList
              items={issuesSolved}
              empty="No Issues were solved during this Meeting"
            />
          </Section>

          {newIssues.length > 0 && (
            <Section title="Issues Created">
              <ItemList items={newIssues} empty="" />
            </Section>
          )}

          <Section title="Short-Term Issues">
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Total Tracked Issues"
                value={stats.totalTrackedIssues.toString()}
              />
              <StatCard
                label="Issues Solved Today"
                value={stats.issuesSolvedToday.toString()}
              />
              <StatCard
                label="Solve Rate"
                value={
                  stats.solveRatePercent == null
                    ? "—"
                    : `${stats.solveRatePercent}%`
                }
                emphasis
              />
              <StatCard
                label="Meeting Length"
                value={meetingMinutes != null ? `${meetingMinutes}m` : "—"}
              />
            </div>
          </Section>

          <Section title="Headlines">
            <ItemList items={newHeadlines} empty="No headlines this meeting" />
          </Section>

          <Section title="Meeting Notes">
            {notes && notes.trim().length > 0 ? (
              <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                {notes}
              </p>
            ) : (
              <EmptyHint>No notes recorded</EmptyHint>
            )}
          </Section>

          <Section title="Ratings">
            {attendeeRatings.length === 0 ? (
              <EmptyHint>No attendees</EmptyHint>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-md border border-zinc-200 dark:border-zinc-800">
                {attendeeRatings.map((r) => (
                  <li
                    key={r.user_id}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <span
                      className={
                        r.absent
                          ? "text-zinc-500 dark:text-zinc-500"
                          : "text-zinc-700 dark:text-zinc-200"
                      }
                    >
                      {r.full_name}
                    </span>
                    <span
                      className={
                        r.absent
                          ? "text-xs uppercase tracking-wide text-zinc-500"
                          : r.average == null
                            ? "text-zinc-500"
                            : "font-semibold text-hpb-blue"
                      }
                    >
                      {r.absent
                        ? "Absent"
                        : r.average == null
                          ? "N/A"
                          : r.average.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-300 dark:border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={close}
            className="rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ItemList({ items, empty }: { items: RecapItem[]; empty: string }) {
  if (items.length === 0) {
    if (!empty) return null;
    return (
      <div className="rounded-md bg-hpb-gold/10 px-3 py-2 text-center text-xs text-hpb-brown dark:text-hpb-gold ring-1 ring-inset ring-hpb-gold/30">
        {empty}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-md border border-zinc-200 dark:border-zinc-800">
      {items.map((it) => (
        <li
          key={it.id}
          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
        >
          <span className="truncate text-zinc-700 dark:text-zinc-200">
            {it.title}
          </span>
          {it.owner_name && (
            <OwnerPill name={it.owner_name} />
          )}
        </li>
      ))}
    </ul>
  );
}

function OwnerPill({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      title={name}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hpb-blue/10 text-[10px] font-semibold text-hpb-blue ring-1 ring-inset ring-hpb-blue/30"
    >
      {initials || "?"}
    </span>
  );
}

function StatCard({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-3 text-center">
      <div className="text-[11px] uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        {label}
      </div>
      <div
        className={
          "mt-1 text-2xl font-semibold tabular-nums " +
          (emphasis ? "text-hpb-blue" : "text-zinc-900 dark:text-zinc-100")
        }
      >
        {value}
      </div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-zinc-600 dark:text-zinc-400">{children}</p>
  );
}
