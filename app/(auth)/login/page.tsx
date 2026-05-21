import Link from "next/link";
import { verifySession } from "@/lib/firebase/session";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);

  const session = await verifySession();

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-bold uppercase tracking-wide text-hpb-blue dark:text-hpb-gold">
            High Plains Bank
          </h1>
          <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
            Employee Owned • Community Driven
          </p>
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            {session
              ? "You're already signed in."
              : "Sign in with your Google account to continue."}
          </p>
        </div>

        {session ? (
          <Link
            href={next}
            className="block w-full rounded-md bg-hpb-blue px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-90"
          >
            Continue to app
          </Link>
        ) : (
          <LoginForm next={next} />
        )}
      </div>
    </div>
  );
}

function safeNext(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/my90";
}
