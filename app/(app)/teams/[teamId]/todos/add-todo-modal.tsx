"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { daysFromNow } from "@/lib/dates";
import { addTodo } from "./actions";

type Member = { user_id: string; full_name: string };

/**
 * "Add to-do" button + modal. Same pattern as scorecard Add measurable.
 * Optional meetingId tags L10 captures with source_meeting_id and defaults
 * visibility to team (private/description still available on standalone).
 */
export function AddTodoModal({
  teamId,
  members,
  defaultOwnerId,
  meetingId,
  buttonLabel = "Add to-do",
  compact = false,
}: {
  teamId: string;
  members: Member[];
  defaultOwnerId: string;
  /** When set, to-do is linked to this L10 meeting. */
  meetingId?: string;
  buttonLabel?: string;
  /** Smaller trigger for the L10 toolbar row. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [due, setDue] = useState(daysFromNow(7));
  const [visibility, setVisibility] = useState<"team" | "private">("team");
  const [description, setDescription] = useState("");

  function resetForOpen() {
    setTitle("");
    setOwnerId(defaultOwnerId);
    setDue(daysFromNow(7));
    setVisibility("team");
    setDescription("");
    setError(null);
  }

  function openModal() {
    resetForOpen();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title required");
      return;
    }
    const fd = new FormData();
    fd.set("title", title);
    fd.set("owner_id", ownerId);
    fd.set("due_date", due);
    fd.set("visibility", meetingId ? "team" : visibility);
    fd.set("description", description);
    if (meetingId) fd.set("source_meeting_id", meetingId);

    start(async () => {
      try {
        setError(null);
        await addTodo(teamId, fd);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={
          compact
            ? "inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
            : "inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
        }
      >
        <Plus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {buttonLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add to-do"
            className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-base font-semibold tracking-tight">
                Add to-do
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={submit}
              className="flex flex-col gap-3 overflow-y-auto px-5 py-4"
            >
              <label className="block space-y-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Title
                </span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="To-do (one line)"
                  required
                  autoFocus
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Owner
                  </span>
                  <select
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Due date
                  </span>
                  <input
                    type="date"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
              </div>

              {!meetingId && (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Visibility
                  </span>
                  <select
                    value={visibility}
                    onChange={(e) =>
                      setVisibility(e.target.value as "team" | "private")
                    }
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <option value="team">Team</option>
                    <option value="private">Private</option>
                  </select>
                </label>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Notes{" "}
                  <span className="font-normal text-zinc-400">(optional)</span>
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add notes or context"
                  rows={3}
                  className="w-full resize-none rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <div className="mt-1 flex justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {pending ? "Adding…" : "Add to-do"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
