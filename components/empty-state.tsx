import type { ReactNode } from "react";

// Shared friendly empty state. Renders a centered icon chip + title + optional
// hint so un-seeded screens read as intentional rather than broken.
export function EmptyState({
  icon: Icon,
  title,
  hint,
  className = "",
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-4 py-10 text-center ${className}`}
    >
      {Icon && (
        <div className="rounded-full bg-hpb-blue/10 p-2.5 text-hpb-blue">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {title}
      </p>
      {hint && (
        <p className="max-w-sm text-xs text-zinc-600 dark:text-zinc-400">
          {hint}
        </p>
      )}
    </div>
  );
}
