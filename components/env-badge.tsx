// Environment marker for telling deployments apart at a glance — the client's
// GCP project vs. the consultant's trial, which are otherwise pixel-identical.
//
// Reads a RUNTIME env var, deliberately not a NEXT_PUBLIC_ one: those are
// inlined into the bundle at build time, so relabelling a deployment would
// mean a rebuild. Every consumer here is a server component, so plain
// process.env is read per-request and the label can be changed with a
// `gcloud run services update` in seconds.
//
// Unset = render nothing. A deployment with no label is the normal one.

const TONES = {
  amber: "bg-amber-400 text-amber-950 border-amber-500",
  red: "bg-red-500 text-white border-red-600",
  blue: "bg-sky-500 text-white border-sky-600",
  zinc: "bg-zinc-700 text-white border-zinc-800",
} as const;

type Tone = keyof typeof TONES;

function tone(): Tone {
  const t = (process.env.ENV_LABEL_TONE ?? "").toLowerCase();
  return t in TONES ? (t as Tone) : "amber";
}

export function envLabel(): string | null {
  return process.env.ENV_LABEL?.trim() || null;
}

// Inline pill — for placing next to a logo or heading.
export function EnvBadge({ className = "" }: { className?: string }) {
  const label = envLabel();
  if (!label) return null;

  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TONES[tone()]} ${className}`}
    >
      {label}
    </span>
  );
}

// Full-width strip — for the top of the viewport, where it can't be missed.
export function EnvBanner() {
  const label = envLabel();
  if (!label) return null;

  return (
    <div
      className={`w-full border-b px-3 py-1 text-center text-[11px] font-bold uppercase tracking-wider ${TONES[tone()]}`}
    >
      {label}
    </div>
  );
}
