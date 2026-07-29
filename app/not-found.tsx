import Link from "next/link";

// Root not-found — what notFound() renders (missing/foreign team or meeting
// ids, deleted docs). Without this, Next's unstyled default 404 appears.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-zinc-300 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-3xl font-semibold text-zinc-300 dark:text-zinc-700">
          404
        </div>
        <h1 className="mt-2 text-base font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          This page doesn&apos;t exist or you don&apos;t have access to it —
          the meeting or team may have been deleted.
        </p>
        <Link
          href="/home"
          className="mt-4 inline-block rounded-md bg-hpb-blue px-4 py-1.5 text-sm font-medium text-white hover:brightness-110"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
