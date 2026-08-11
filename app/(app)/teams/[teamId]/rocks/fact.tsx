import { cn } from "@/lib/utils";

/** One cell of the owner / quarter / due / milestones strip, shared by the
 *  expanded rock row and the rock detail modal so the two stay in step. */
export function Fact({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-[130px] flex-1 px-3.5 py-[11px]",
        !last && "border-r border-zinc-100 dark:border-zinc-800",
      )}
    >
      <dt className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-zinc-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] font-bold text-zinc-800 dark:text-zinc-200">
        {children}
      </dd>
    </div>
  );
}
