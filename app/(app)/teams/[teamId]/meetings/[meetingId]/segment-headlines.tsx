"use client";

import { useMemo, useState, useTransition } from "react";
import { Smile, Users, Megaphone, Info, Trash2 } from "lucide-react";
import {
  collection,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useCollection } from "@/lib/firebase/use-collection";
import { groupByOwner, splitCascadingSection } from "@/lib/headlines";
import { RichText } from "@/components/rich-text";
import { addHeadline, deleteHeadline } from "../../headlines/actions";
import { HeadlineDiscussedCheckbox } from "../../headlines/headline-checkbox";
import { HeadlineEditButton } from "../../headlines/headline-edit-modal";
import { LocalTime } from "@/components/local-time";
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

export type HeadlineDoc = {
  id: string;
  team_id: string;
  title: string;
  body: string | null;
  kind: "customer" | "employee" | "cascading" | "general";
  created_by: string | null;
  created_at: MaybeTimestamp;
  discussed?: boolean;
  archived_at?: MaybeTimestamp;
  broadcast?: boolean;
  from_label?: string | null;
  source_owner_name?: string | null;
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
  general: {
    label: "General / FYI",
    badge:
      "bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 ring-slate-200",
    Icon: Info,
  },
};

function isArchived(h: HeadlineDoc): boolean {
  return h.archived_at != null;
}

export function SegmentHeadlines({
  teamId,
  meetingId,
  userId,
  initialHeadlines,
  members,
}: {
  teamId: string;
  meetingId: string;
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

  // Active only — archived drop out of the live L10 list (selective archive).
  const active = headlines.filter((h) => !isArchived(h));
  // Undiscussed first (still need airtime), then discussed, then by recency.
  const byDiscussedThenRecency = (a: HeadlineDoc, b: HeadlineDoc) => {
    const ad = a.discussed === true ? 1 : 0;
    const bd = b.discussed === true ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return (tsMs(b.created_at) ?? 0) - (tsMs(a.created_at) ?? 0);
  };

  const creatorName = (h: HeadlineDoc) => {
    if (h.created_by === userId) return "You";
    if (h.created_by) {
      return members.find((m) => m.user_id === h.created_by)?.full_name ?? "—";
    }
    return h.source_owner_name || h.from_label || "—";
  };

  // Team's own headlines (grouped by owner) separated from cascading —
  // cascading-kind headlines this team posted plus incoming broadcast
  // copies from elsewhere in the org. Same split/grouping rules as the
  // standalone Headlines tab (lib/headlines.ts) so the two surfaces agree.
  const { team, cascading } = splitCascadingSection(active);
  const sortedTeam = [...team].sort(byDiscussedThenRecency);
  const sortedCascading = [...cascading].sort(byDiscussedThenRecency);
  const ownerGroups = groupByOwner(sortedTeam, creatorName);

  function renderRow(h: HeadlineDoc) {
    const meta = KIND_META[h.kind] ?? KIND_META.customer;
    const remove = deleteHeadline.bind(null, teamId, h.id);
    const readOnly = !!h.broadcast;
    const discussed = h.discussed === true;
    return (
      <div
        key={h.id}
        className={`group flex items-start gap-3 px-4 py-3 text-sm ${
          discussed ? "bg-zinc-50/80 dark:bg-zinc-950/40" : ""
        }`}
      >
        <HeadlineDiscussedCheckbox
          teamId={teamId}
          headlineId={h.id}
          discussed={discussed}
          disabled={readOnly}
        />
        <div
          className={`mt-0.5 rounded-full p-1.5 ring-1 ring-inset ${meta.badge}`}
          title={meta.label}
        >
          <meta.Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`font-medium ${discussed ? "text-zinc-600 line-through dark:text-zinc-400" : ""}`}
            >
              {h.title}
            </div>
            {discussed && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800">
                Discussed
              </span>
            )}
            {readOnly && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700">
                Org-wide · read-only
              </span>
            )}
          </div>
          {h.body && (
            <RichText
              value={h.body}
              className="mt-0.5 text-zinc-600 dark:text-zinc-400"
            />
          )}
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
            {meta.label}
            {h.from_label ? ` · ${h.from_label}` : ""} ·{" "}
            {creatorName(h)} ·{" "}
            <LocalTime
              ms={tsMs(h.created_at)}
              options={{
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }}
            />
          </div>
        </div>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
            <HeadlineEditButton
              teamId={teamId}
              headline={{
                id: h.id,
                title: h.title,
                body: h.body,
                kind: h.kind,
              }}
            />
            <form
              action={remove}
              onSubmit={(e) => {
                if (
                  !window.confirm(
                    "Delete this headline? This can't be undone.",
                  )
                )
                  e.preventDefault();
              }}
            >
              <button
                type="submit"
                className="rounded p-1 text-zinc-300 hover:bg-red-50 hover:text-red-600 dark:text-zinc-600 dark:hover:bg-red-950/40"
                aria-label="Delete headline"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <QuickAddIssue
          teamId={teamId}
          prefill="From headline: "
          meetingId={meetingId}
        />
      </div>

      <QuickAddHeadline teamId={teamId} />

      {active.length === 0 ? (
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No headlines yet.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {ownerGroups.length > 0 && (
            <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
              {ownerGroups.map((group) => (
                <div key={group.name}>
                  <div className="bg-zinc-50 px-4 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-500">
                    {group.name}
                  </div>
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {group.headlines.map(renderRow)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {sortedCascading.length > 0 && (
            <div>
              <h2 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Cascading
              </h2>
              <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                {sortedCascading.map(renderRow)}
              </div>
            </div>
          )}
        </div>
      )}
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
        <option value="general">General / FYI</option>
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
