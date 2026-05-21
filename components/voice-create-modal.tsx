"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Loader2, X, Check } from "lucide-react";
import {
  voiceParse,
  voiceCommit,
  type ParsedVoice,
  type ResolvedAction,
  type CommitResult,
} from "@/app/(app)/voice-create-action";

type Phase =
  | "idle"
  | "recording"
  | "parsing"
  | "preview"
  | "committing"
  | "done"
  | "error";

const STATUS_LABEL: Record<string, string> = {
  on_track: "On Track",
  off_track: "Off Track",
  done: "Done",
  cancelled: "Cancelled",
};
const STATUS_STYLE: Record<string, string> = {
  on_track:
    "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300",
  off_track:
    "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300",
  done: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
  cancelled: "bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400",
};

export function VoiceCreateModal({
  open,
  onClose,
  teamId,
}: {
  open: boolean;
  onClose: () => void;
  teamId: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedVoice | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      cleanup();
      setPhase("idle");
      setElapsed(0);
      setError(null);
      setParsed(null);
      setResult(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function cleanup() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        // already stopped
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
  }

  async function startRecording() {
    setError(null);
    setParsed(null);
    setResult(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone API not available in this browser");
      setPhase("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void submitForParse();
      recorder.start();
      recorderRef.current = recorder;
      setPhase("recording");
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not access microphone",
      );
      setPhase("error");
    }
  }

  function stopRecording() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
    setPhase("parsing");
  }

  async function submitForParse() {
    try {
      const blob = new Blob(chunksRef.current, {
        type: recorderRef.current?.mimeType || "audio/webm",
      });
      if (blob.size === 0) {
        setError("No audio captured");
        setPhase("error");
        return;
      }
      const fd = new FormData();
      const ext = blob.type.includes("ogg") ? "ogg" : "webm";
      fd.append("audio", new File([blob], `voice.${ext}`, { type: blob.type }));
      if (teamId) fd.append("team_id", teamId);

      const out = await voiceParse(fd);
      setParsed(out);
      setPhase("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    } finally {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }
  }

  async function confirmCommit() {
    if (!parsed) return;
    setPhase("committing");
    try {
      const out = await voiceCommit(parsed);
      setResult(out);
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(480px,92vw)] max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2 sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Voice command
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-5 pt-3">
          {phase === "idle" && <IdleView onStart={startRecording} />}
          {phase === "recording" && (
            <RecordingView elapsed={elapsed} onStop={stopRecording} />
          )}
          {phase === "parsing" && (
            <BusyView label="Transcribing and classifying…" />
          )}
          {phase === "preview" && parsed && (
            <PreviewView
              parsed={parsed}
              onCancel={() => {
                setParsed(null);
                setPhase("idle");
              }}
              onConfirm={confirmCommit}
            />
          )}
          {phase === "committing" && <BusyView label="Applying…" />}
          {phase === "done" && result && (
            <DoneView
              result={result}
              onAnother={() => {
                setResult(null);
                setParsed(null);
                setPhase("idle");
              }}
              onClose={onClose}
            />
          )}
          {phase === "error" && (
            <ErrorView
              message={error ?? "Something went wrong"}
              onRetry={() => {
                setError(null);
                setParsed(null);
                setPhase("idle");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function IdleView({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <button
        type="button"
        onClick={onStart}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        aria-label="Start recording"
      >
        <Mic className="h-8 w-8" />
      </button>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        Tap to speak. You can chain multiple requests in one command.
      </p>
      <ul className="text-center text-xs text-zinc-400 space-y-0.5">
        <li>“Remind me to send the audit pack by Friday.”</li>
        <li>“Set the lending rock off track — vendor delays.”</li>
        <li>“Add a milestone X to the deposit rock and remind me to follow up Monday.”</li>
      </ul>
    </div>
  );
}

function RecordingView({
  elapsed,
  onStop,
}: {
  elapsed: number;
  onStop: () => void;
}) {
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <button
        type="button"
        onClick={onStop}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 animate-pulse"
        aria-label="Stop recording"
      >
        <Square className="h-7 w-7 fill-current" />
      </button>
      <p className="tabular-nums text-sm text-zinc-600 dark:text-zinc-400">
        Recording · {mm}:{ss}
      </p>
      <p className="text-center text-xs text-zinc-400">Tap to stop</p>
    </div>
  );
}

function BusyView({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{label}</p>
    </div>
  );
}

function PreviewView({
  parsed,
  onCancel,
  onConfirm,
}: {
  parsed: ParsedVoice;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const n = parsed.items.length;
  const confirmLabel =
    n === 1 ? singleConfirmLabel(parsed.items[0]) : `Apply ${n} changes`;

  return (
    <div className="flex flex-col gap-3">
      {n > 1 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {n} changes in this command
        </p>
      )}

      <div className="flex flex-col gap-2">
        {parsed.items.map((item, i) => (
          <ItemCard key={i} item={item} />
        ))}
      </div>

      {parsed.transcript && (
        <p className="text-xs italic text-zinc-500 dark:text-zinc-400 border-l-2 border-zinc-200 dark:border-zinc-800 pl-3 mt-1">
          “{parsed.transcript}”
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-1.5 text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function ItemCard({ item }: { item: ResolvedAction }) {
  const { header, rows } = describeItem(item);
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium">
        {header.kicker}
      </div>
      <div className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {header.title}
      </div>
      {header.subtitle && (
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {header.subtitle}
        </div>
      )}
      {rows.length > 0 && (
        <dl className="mt-2 grid grid-cols-[72px_1fr] gap-y-1 text-xs">
          {rows.map((r) => (
            <PreviewRow key={r.label} label={r.label}>
              {r.value}
            </PreviewRow>
          ))}
        </dl>
      )}
    </div>
  );
}

function PreviewRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-900 dark:text-zinc-100">{children}</dd>
    </>
  );
}

function singleConfirmLabel(item: ResolvedAction): string {
  switch (item.action) {
    case "create_todo":
      return "Create to-do";
    case "create_issue":
      return "Create issue";
    case "create_rock":
      return "Create rock";
    case "update_rock_status":
      return "Update status";
    case "add_milestone":
      return "Add milestone";
    case "complete_milestone":
      return "Mark complete";
  }
}

function describeItem(item: ResolvedAction): {
  header: { kicker: string; title: string; subtitle?: string };
  rows: { label: string; value: React.ReactNode }[];
} {
  switch (item.action) {
    case "create_todo":
      return {
        header: { kicker: "New To-do", title: item.title },
        rows: [
          { label: "Owner", value: item.owner_name },
          { label: "Due", value: formatDue(item.due_date) },
          ...(item.description
            ? [{ label: "Notes", value: item.description }]
            : []),
        ],
      };
    case "create_issue":
      return {
        header: { kicker: "New Issue", title: item.title },
        rows: item.description
          ? [{ label: "Notes", value: item.description }]
          : [],
      };
    case "create_rock":
      return {
        header: { kicker: "New Rock", title: item.title },
        rows: [
          { label: "Owner", value: item.owner_name },
          { label: "Due", value: formatDue(item.due_date) },
          { label: "Quarter", value: item.quarter },
          ...(item.description
            ? [{ label: "Notes", value: item.description }]
            : []),
        ],
      };
    case "update_rock_status":
      return {
        header: { kicker: "Update Rock Status", title: item.rock_title },
        rows: [
          {
            label: "Status",
            value: (
              <span
                className={
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium " +
                  (STATUS_STYLE[item.status] ?? "")
                }
              >
                {STATUS_LABEL[item.status] ?? item.status}
              </span>
            ),
          },
          ...(item.comment ? [{ label: "Comment", value: item.comment }] : []),
        ],
      };
    case "add_milestone":
      return {
        header: {
          kicker: "New Milestone",
          title: item.title,
          subtitle: `Under: ${item.rock_title}`,
        },
        rows: [
          { label: "Owner", value: item.owner_name },
          { label: "Due", value: formatDue(item.due_date) },
        ],
      };
    case "complete_milestone":
      return {
        header: {
          kicker: "Complete Milestone",
          title: item.milestone_title,
          subtitle: `Under: ${item.rock_title}`,
        },
        rows: [],
      };
  }
}

function DoneView({
  result,
  onAnother,
  onClose,
}: {
  result: CommitResult;
  onAnother: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <Check className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Done
          </div>
          <ul className="mt-1 space-y-1">
            {result.summaries.map((s, i) => (
              <li
                key={i}
                className="text-sm text-zinc-900 dark:text-zinc-100"
              >
                {s.summary}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-between pt-2">
        <a
          href={result.path}
          onClick={onClose}
          className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 underline-offset-2 hover:underline"
        >
          View →
        </a>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onAnother}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Another
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1.5 text-xs font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 py-4">
      <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="self-end rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1.5 text-xs font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200"
      >
        Try again
      </button>
    </div>
  );
}

function formatDue(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}
