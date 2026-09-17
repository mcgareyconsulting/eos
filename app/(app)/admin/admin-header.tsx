export function AdminHeader({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <header>
      <div className="flex items-center gap-2 text-hpb-blue dark:text-hpb-gold">
        <span className="text-xs font-semibold uppercase tracking-wide">
          Org admin
        </span>
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {title}
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        {blurb}
      </p>
    </header>
  );
}
