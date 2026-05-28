"use client";

import { useMemo, useState, useTransition } from "react";
import { Smile, Users, Megaphone, Trash2 } from "lucide-react";
import {
  collection,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { addHeadline, deleteHeadline } from "../../headlines/actions";
import { QuickAddIssue } from "@/components/quick-add-issue";

// created_at arrives as a Firestore Timestamp from onSnapshot, but as a
// plain millis number when pre-rendered on the server (RSC boundary can't
// carry Timestamp class instances). Accept either.
type MaybeTimestamp =
  | { toMillis: () => number; toDate: () => Date }
  | number
  | null;

function tsMs(t: MaybeTimestamp): number | null {
  if (t == null) return null;
  if (typeof t === "number") return t;
  return typeof t.toMillis === "function" ? t.toMillis() : null;
}
function tsDate(t: MaybeTimestamp): Date | null {
  if (t == null) return null;
  if (typeof t === "number") return new Date(t);
  return typeof t.toDate === "function" ? t.toDate() : null;
}

type HeadlineDoc = {
  id: string;
  team_id: string;
  title: string;
  body: string | null;
  kind: "customer" | "employee" | "cascading";
  created_by: string | null;
  created_at: MaybeTimestamp;
};

type Member = { user_id: string; full_name: string };

const KIND_META: Record<
  HeadlineDoc["kind"],
  { label: string; badge: string; Icon: typeof Smile }
> = {
  customer: {
    label: "Customer",
    badge:
      "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 ring-emerald-200",
    Icon: Smile,
  },
  employee: {
    label: "Employee",
    badge:
      "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ring-blue-200",
    Icon: Users,
  },
  cascading: {
    label: "Cascading",
    badge:
      "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 ring-amber-200",
    Icon: Megaphone,
  },
};

export function SegmentHeadlines({
  teamId,
  userId,
  initialHeadlines,
  members,
}: {
  teamId: string;
  userId: string;
  initialHeadlines: HeadlineDoc[];
  members: Member[];
}) {
  const db = getClientDb();

  const q = useMemo(
    () =>
      fsQuery(collection(db, "headlines"), where("team_id", "==", teamId)),
    [db, teamId],
  );
  const headlines = useCollection<HeadlineDoc>(q, initialHeadlines);

  const sorted = [...headlines].sort(
    (a, b) => (tsMs(b.created_at) ?? 0) - (tsMs(a.created_at) ?? 0),
  );

  const creatorName = (id: string | null) =>
    id === userId
      ? "You"
      : id
        ? members.find((m) => m.user_id === id)?.full_name ?? "—"
        : "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          Customer wins, employee news, cascading messages
        </div>
        <QuickAddIssue
          teamId={teamId}
          prefill="From headline: "
          compact
        />
      </div>

      <QuickAddHeadline teamId={teamId} />

      <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
        {sorted.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No headlines yet.
          </div>
        )}
        {sorted.map((h) => {
          const meta = KIND_META[h.kind] ?? KIND_META.customer;
          const remove = deleteHeadline.bind(null, teamId, h.id);
          const when =
            tsDate(h.created_at)?.toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }) ?? "—";
          return (
            <div
              key={h.id}
              className="group flex items-start gap-3 px-4 py-3 text-sm"
            >
              <div
                className={`mt-0.5 rounded-full p-1.5 ring-1 ring-inset ${meta.badge}`}
                title={meta.label}
              >
                <meta.Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{h.title}</div>
                {h.body && (
                  <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                    {h.body}
                  </div>
                )}
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
                  {meta.label} · {creatorName(h.created_by)} · {when}
                </div>
              </div>
              <form action={remove}>
                <button
                  type="submit"
                  className="text-zinc-300 dark:text-zinc-600 hover:text-red-600 opacity-0 group-hover:opacity-100 mt-1"
                  aria-label="Delete headline"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuickAddHeadline({ teamId }: { teamId: string }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<HeadlineDoc["kind"]>("customer");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const t = title.trim();
    if (!t) return;
    const fd = new FormData();
    fd.set("title", t);
    fd.set("kind", kind);
    start(async () => {
      try {
        setError(null);
        await addHeadline(teamId, fd);
        setTitle("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as HeadlineDoc["kind"])}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs"
      >
        <option value="customer">Customer</option>
        <option value="employee">Employee</option>
        <option value="cascading">Cascading</option>
      </select>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Headline (one line)"
        className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || !title.trim()}
        className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1 text-xs font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
