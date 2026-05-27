"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Send, X, Check, Loader2, Trash2 } from "lucide-react";
import {
  chatTurn,
  chatCommit,
  type ResolvedAction,
  type CommitResult,
  type ChatReply,
} from "@/app/(app)/voice-create-action";
import type { ActionItem } from "@/lib/voice/parse";

type ProposalStatus = "pending" | "applied" | "cancelled" | "superseded";

type Proposal = {
  items: ResolvedAction[];
  raw: ActionItem[];
  status: ProposalStatus;
  result?: CommitResult;
};

type Msg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; proposal?: Proposal };

const STATUS_LABEL: Record<string, string> = {
  on_track: "On Track",
  off_track: "Off Track",
  done: "Done",
  cancelled: "Cancelled",
};
const STATUS_STYLE: Record<string, string> = {
  on_track:
    "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300",
  off_track: "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300",
  done: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
  cancelled: "bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400",
};

export function ChatPanel({
  teamId,
  onClose,
}: {
  teamId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const storageKey = `eos-chat:${teamId ?? "none"}`;
  // Conversation persists across close/reopen and reloads (per team, per tab).
  const [messages, setMessages] = useState<Msg[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Msg[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => stopStream();
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, busy, recording]);

  useEffect(() => {
    try {
      if (messages.length) {
        sessionStorage.setItem(storageKey, JSON.stringify(messages));
      } else {
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      // storage unavailable (private mode / quota) — history just won't persist
    }
  }, [messages, storageKey]);

  function clearChat() {
    setMessages([]);
    setInput("");
  }

  function stopStream() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  // --- conversation helpers -------------------------------------------------

  function buildHistory(): { role: "user" | "assistant"; text: string }[] {
    return messages
      .filter((m) => m.text.trim() && !m.text.startsWith("🎤"))
      .map((m) => ({ role: m.role, text: m.text }));
  }

  function latestPendingRaw(): ActionItem[] {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.proposal?.status === "pending") {
        return m.proposal.raw;
      }
    }
    return [];
  }

  async function runTurn(fd: FormData, userMsgId: string, audioFallback?: string) {
    setBusy(true);
    try {
      const reply: ChatReply = await chatTurn(fd);
      if (audioFallback !== undefined) {
        const shown = reply.transcript.trim() || audioFallback;
        setMessages((ms) =>
          ms.map((m) =>
            m.id === userMsgId && m.role === "user" ? { ...m, text: shown } : m,
          ),
        );
      }
      setMessages((ms) => {
        const hasItems = reply.items.length > 0;
        const next = hasItems
          ? ms.map((m) =>
              m.role === "assistant" && m.proposal?.status === "pending"
                ? { ...m, proposal: { ...m.proposal, status: "superseded" as const } }
                : m,
            )
          : ms;
        const assistant: Msg = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: reply.reply,
          proposal: hasItems
            ? { items: reply.items, raw: reply.rawActions, status: "pending" }
            : undefined,
        };
        return [...next, assistant];
      });
    } catch (e) {
      setMessages((ms) => [
        ...ms,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: e instanceof Error ? e.message : String(e),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function baseForm(history: { role: string; text: string }[], pending: ActionItem[]) {
    const fd = new FormData();
    if (teamId) fd.append("team_id", teamId);
    fd.append("history", JSON.stringify(history));
    fd.append("pending", JSON.stringify(pending));
    return fd;
  }

  async function sendText() {
    const text = input.trim();
    if (!text || busy) return;
    const userId = crypto.randomUUID();
    const fd = baseForm(buildHistory(), latestPendingRaw());
    fd.append("text", text);
    setMessages((ms) => [...ms, { id: userId, role: "user", text }]);
    setInput("");
    await runTurn(fd, userId);
  }

  // --- recording ------------------------------------------------------------

  async function startRecording() {
    if (busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessages((ms) => [
        ...ms,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Microphone isn't available in this browser.",
        },
      ]);
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
      recorder.onstop = () => void submitAudio();
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e) {
      setMessages((ms) => [
        ...ms,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: e instanceof Error ? e.message : "Could not access microphone.",
        },
      ]);
    }
  }

  function stopRecording() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
    setRecording(false);
  }

  async function submitAudio() {
    const blob = new Blob(chunksRef.current, {
      type: recorderRef.current?.mimeType || "audio/webm",
    });
    stopStream();
    if (blob.size === 0) return;
    const userId = crypto.randomUUID();
    const fd = baseForm(buildHistory(), latestPendingRaw());
    const ext = blob.type.includes("ogg") ? "ogg" : "webm";
    fd.append("audio", new File([blob], `voice.${ext}`, { type: blob.type }));
    setMessages((ms) => [
      ...ms,
      { id: userId, role: "user", text: "🎤 transcribing…" },
    ]);
    await runTurn(fd, userId, "🎤 voice note");
  }

  // --- proposal actions (HITL gate) -----------------------------------------

  async function applyProposal(msgId: string) {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg || msg.role !== "assistant" || !msg.proposal || !teamId || busy) return;
    const items = msg.proposal.items;
    setBusy(true);
    try {
      const result = await chatCommit({ teamId, items, transcript: "" });
      setMessages((ms) =>
        ms.map((m) =>
          m.id === msgId && m.role === "assistant" && m.proposal
            ? { ...m, proposal: { ...m.proposal, status: "applied", result } }
            : m,
        ),
      );
      router.refresh();
    } catch (e) {
      setMessages((ms) => [
        ...ms,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: e instanceof Error ? e.message : String(e),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function cancelProposal(msgId: string) {
    setMessages((ms) =>
      ms.map((m) =>
        m.id === msgId && m.role === "assistant" && m.proposal
          ? { ...m, proposal: { ...m.proposal, status: "cancelled" } }
          : m,
      ),
    );
  }

  // --- render ---------------------------------------------------------------

  return (
    <div className="fixed bottom-20 right-5 z-50 flex h-[520px] max-h-[calc(100vh-7rem)] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Assistant
        </h2>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              disabled={busy}
              aria-label="Clear conversation"
              title="Clear conversation"
              className="rounded p-1 text-zinc-400 hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (keeps history)"
            className="rounded p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <EmptyState />}
        {messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.text} />
          ) : (
            <AssistantTurn
              key={m.id}
              msg={m}
              busy={busy}
              canCommit={!!teamId}
              onApply={() => applyProposal(m.id)}
              onCancel={() => cancelProposal(m.id)}
            />
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      <div className="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
        {recording ? (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
              Recording · {fmtElapsed(elapsed)}
            </span>
            <button
              type="button"
              onClick={stopRecording}
              className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              <Square className="h-3.5 w-3.5 fill-current" /> Stop
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendText();
                }
              }}
              rows={1}
              placeholder="Ask or tell me what to change…"
              disabled={busy}
              className="max-h-28 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-100"
            />
            {input.trim() ? (
              <button
                type="button"
                onClick={() => void sendText()}
                disabled={busy}
                aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Send className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startRecording()}
                disabled={busy}
                aria-label="Record voice"
                title="Hold a thought? Speak it."
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-6 text-center">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Type or tap the mic. I can answer questions or propose changes.
      </p>
      <ul className="mt-2 space-y-0.5 text-xs text-zinc-400">
        <li>“Which rocks are off track?”</li>
        <li>“Remind me to send the audit pack by Friday.”</li>
        <li>“Set the lending rock off track — vendor delays.”</li>
      </ul>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
        {text}
      </div>
    </div>
  );
}

function AssistantTurn({
  msg,
  busy,
  canCommit,
  onApply,
  onCancel,
}: {
  msg: Extract<Msg, { role: "assistant" }>;
  busy: boolean;
  canCommit: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {msg.text.trim() && (
        <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-1.5 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
          {msg.text}
        </div>
      )}
      {msg.proposal && (
        <ProposalCard
          proposal={msg.proposal}
          busy={busy}
          canCommit={canCommit}
          onApply={onApply}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  busy,
  canCommit,
  onApply,
  onCancel,
}: {
  proposal: Proposal;
  busy: boolean;
  canCommit: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const n = proposal.items.length;
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex flex-col gap-2">
        {proposal.items.map((item, i) => (
          <ItemCard key={i} item={item} />
        ))}
      </div>

      {proposal.status === "pending" && (
        <div className="mt-2.5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy || !canCommit}
            title={canCommit ? undefined : "No team selected"}
            className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {n === 1 ? singleConfirmLabel(proposal.items[0]) : `Apply ${n} changes`}
          </button>
        </div>
      )}

      {proposal.status === "applied" && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
          <Check className="h-3.5 w-3.5" />
          <span>Applied</span>
          {proposal.result?.path && (
            <a
              href={proposal.result.path}
              className="ml-auto text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              View →
            </a>
          )}
        </div>
      )}
      {proposal.status === "cancelled" && (
        <div className="mt-2 text-xs text-zinc-400">Cancelled</div>
      )}
      {proposal.status === "superseded" && (
        <div className="mt-2 text-xs text-zinc-400">Updated below ↓</div>
      )}
    </div>
  );
}

function ItemCard({ item }: { item: ResolvedAction }) {
  const { header, rows } = describeItem(item);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
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
        <dl className="mt-1.5 grid grid-cols-[64px_1fr] gap-y-0.5 text-xs">
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-zinc-500">{r.label}</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
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
    case "complete_todo":
      return "Close to-do";
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
          ...(item.description ? [{ label: "Notes", value: item.description }] : []),
        ],
      };
    case "create_issue":
      return {
        header: { kicker: "New Issue", title: item.title },
        rows: item.description ? [{ label: "Notes", value: item.description }] : [],
      };
    case "create_rock":
      return {
        header: { kicker: "New Rock", title: item.title },
        rows: [
          { label: "Owner", value: item.owner_name },
          { label: "Due", value: formatDue(item.due_date) },
          { label: "Quarter", value: item.quarter },
          ...(item.description ? [{ label: "Notes", value: item.description }] : []),
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
    case "complete_todo":
      return {
        header: { kicker: "Close To-do", title: item.todo_title },
        rows: [],
      };
  }
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

function fmtElapsed(s: number): string {
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
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
