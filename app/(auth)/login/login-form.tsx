"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");

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
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field
        id="full_name"
        name="full_name"
        type="text"
        label="Full name"
        autoComplete="name"
      />
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
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
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
