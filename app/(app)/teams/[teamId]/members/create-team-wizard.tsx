"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Users } from "lucide-react";
import { createTeamWithLeader } from "./create-team-actions";

type Step = 1 | 2 | 3;

/**
 * Admin happy path: team name → invite leader (pre-provision) → Done.
 * Opened from Members → All teams → New team.
 */
export function CreateTeamWizard({
  backHref,
  backLabel = "All teams",
}: {
  /** e.g. /teams/{id}/members?tab=directory */
  backHref: string;
  backLabel?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [teamName, setTeamName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<{
    teamId: string;
    teamName: string;
  } | null>(null);

  function goToLeader() {
    setError(null);
    if (!teamName.trim()) {
      setError("Team name is required");
      return;
    }
    setStep(2);
  }

  function submitLeader(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setError("First name, last name, and email are required");
      return;
    }

    const fd = new FormData();
    fd.set("team_name", teamName.trim());
    fd.set("first_name", firstName.trim());
    fd.set("last_name", lastName.trim());
    fd.set("email", email.trim());

    start(async () => {
      const result = await createTeamWithLeader(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated({ teamId: result.teamId, teamName: result.teamName });
      setStep(3);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="space-y-1">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New team</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Create the team, invite a leader, then they sign in and add members.
        </p>
      </header>

      <StepIndicator step={step} />

      <div className="rounded-xl border border-zinc-300 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        {step === 1 && (
          <div className="space-y-4">
            <Field label="Team name" required>
              <input
                autoFocus
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Enterprise Systems & Data"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    goToLeader();
                  }
                }}
              />
            </Field>
            {error && <ErrorText>{error}</ErrorText>}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={goToLeader}
                className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <form onSubmit={submitLeader} className="space-y-4">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Team:{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {teamName.trim()}
              </span>
              . Pre-provisions the leader&rsquo;s account — no email is sent.
              They sign in with Google using this address.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" required>
                <input
                  autoFocus
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  placeholder="Jane"
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </Field>
              <Field label="Last name" required>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  placeholder="Doe"
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </Field>
            </div>
            <Field label="Email" required>
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="jane.doe@highplainsbank.com"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </Field>
            {error && <ErrorText>{error}</ErrorText>}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep(1);
                }}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create team"}
              </button>
            </div>
          </form>
        )}

        {step === 3 && created && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <Check className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Team created</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  {created.teamName}
                </span>{" "}
                is ready. The leader can sign in and invite members from the
                team&rsquo;s Members page.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link
                href={`/teams/${created.teamId}/members`}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110"
              >
                <Users className="h-4 w-4" />
                Open team
              </Link>
              <Link
                href={backHref}
                className="inline-flex items-center justify-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Back to {backLabel.toLowerCase()}
              </Link>
              <button
                type="button"
                onClick={() => {
                  setTeamName("");
                  setFirstName("");
                  setLastName("");
                  setEmail("");
                  setCreated(null);
                  setError(null);
                  setStep(1);
                }}
                className="inline-flex items-center justify-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Create another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const items: { n: Step; label: string }[] = [
    { n: 1, label: "Name" },
    { n: 2, label: "Leader" },
    { n: 3, label: "Done" },
  ];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {items.map((item, i) => {
        const active = step === item.n;
        const done = step > item.n;
        return (
          <li key={item.n} className="flex items-center gap-2">
            {i > 0 && (
              <span
                className="h-px w-6 bg-zinc-300 dark:bg-zinc-700"
                aria-hidden
              />
            )}
            <span
              className={
                "inline-flex items-center gap-1.5 " +
                (active
                  ? "font-medium text-hpb-blue dark:text-hpb-gold"
                  : done
                    ? "text-zinc-700 dark:text-zinc-300"
                    : "text-zinc-500")
              }
            >
              <span
                className={
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold " +
                  (active || done
                    ? "bg-hpb-blue text-white dark:bg-hpb-gold dark:text-zinc-900"
                    : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400")
                }
              >
                {done ? <Check className="h-3 w-3" /> : item.n}
              </span>
              {item.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-red-600 dark:text-red-400">{children}</p>
  );
}
