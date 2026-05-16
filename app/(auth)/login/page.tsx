import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">EOS</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Sign in or create an account to continue.
          </p>
        </div>
        <LoginForm next={next ?? "/my90"} />
      </div>
    </div>
  );
}
