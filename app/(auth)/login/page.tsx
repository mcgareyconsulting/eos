import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    error?: string;
    error_code?: string;
    error_description?: string;
  }>;
}) {
  const sp = await searchParams;
  const next = sp.next ?? "/my90";
  const urlError = sp.error_description || sp.error;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            High Plains Bank
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Sign in or create an account to continue.
          </p>
        </div>
        {urlError && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-900">
            <div className="font-medium">{urlError.replace(/\+/g, " ")}</div>
            {sp.error_code === "otp_expired" && (
              <div className="mt-1 text-xs">
                Email confirmation is still enabled on the project. Turn it off
                in the Supabase dashboard so signup logs you in immediately.
              </div>
            )}
          </div>
        )}
        <LoginForm next={next} />
      </div>
    </div>
  );
}
