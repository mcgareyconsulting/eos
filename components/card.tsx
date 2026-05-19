export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs uppercase tracking-wide font-medium text-zinc-600 dark:text-zinc-400">
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
      {children}
    </div>
  );
}
