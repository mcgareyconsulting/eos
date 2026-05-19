"use client";

import { useActionState, useEffect, useState } from "react";
import { signIn, signUp, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  // Strip any Supabase redirect error params (?error_code=otp_expired etc.)
  // from the URL on first paint so subsequent failed submits don't compound
  // the stale message with a new one.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of ["error", "error_code", "error_description"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  return mode === "signin" ? (
    <SignInPanel next={next} onSwitch={() => setMode("signup")} />
  ) : (
    <SignUpPanel next={next} onSwitch={() => setMode("signin")} />
  );
}

function SignInPanel({ next, onSwitch }: { next: string; onSwitch: () => void }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    signIn,
    null,
  );
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
      />
      <Field
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-sm text-zinc-500 text-center">
        No account?{" "}
        <button
          type="button"
          onClick={onSwitch}
          className="text-zinc-900 font-medium hover:underline"
        >
          Create one
        </button>
      </p>
    </form>
  );
}

function SignUpPanel({ next, onSwitch }: { next: string; onSwitch: () => void }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    signUp,
    null,
  );

  if (state?.needsConfirmation) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {state.error}
        </div>
        <button
          type="button"
          onClick={onSwitch}
          className="w-full rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="first_name"
          name="first_name"
          type="text"
          label="First name"
          autoComplete="given-name"
          required
        />
        <Field
          id="last_name"
          name="last_name"
          type="text"
          label="Last name"
          autoComplete="family-name"
          required
        />
      </div>
      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
      />
      <Field
        id="password"
        name="password"
        type="password"
        label="Password (min 6)"
        autoComplete="new-password"
        required
      />
      {state?.error && (
        <div className="text-sm text-red-600 space-y-1">
          <p>{state.error}</p>
          {state.alreadyRegistered && (
            <button
              type="button"
              onClick={onSwitch}
              className="text-zinc-900 font-medium underline"
            >
              Sign in instead
            </button>
          )}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p className="text-sm text-zinc-500 text-center">
        Already have one?{" "}
        <button
          type="button"
          onClick={onSwitch}
          className="text-zinc-900 font-medium hover:underline"
        >
          Sign in
        </button>
      </p>
    </form>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, id, className, ...rest } = props;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-zinc-700">
        {label}
      </label>
      <input
        id={id}
        {...rest}
        className={
          "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 " +
          (className ?? "")
        }
      />
    </div>
  );
}
