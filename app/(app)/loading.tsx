export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 rounded-md bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-4 w-72 rounded-md bg-zinc-100 dark:bg-zinc-800" />
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3">
            <div className="h-4 w-4 rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-4 flex-1 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
