"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { addRock } from "./actions";
import { TEAM_OWNER_VALUE } from "./rock-type";

type Member = { user_id: string; full_name: string };

/** Centered "New Rock" modal — same shell as Add issue / Add to-do. */
export function AddRockModal({
  teamId,
  members,
  quarter,
  defaultDue,
  currentUserId,
}: {
  teamId: string;
  members: Member[];
  quarter: string;
  defaultDue: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [qtr, setQtr] = useState(quarter);
  const [due, setDue] = useState(defaultDue);
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [description, setDescription] = useState("");

  function resetForOpen() {
    setTitle("");
    setQtr(quarter);
    setDue(defaultDue);
    setOwnerId(currentUserId);
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

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title required");
      return;
    }
    const fd = new FormData();
    fd.set("title", title);
    fd.set("quarter", qtr);
    fd.set("due_date", due);
    fd.set("owner_id", ownerId);
    fd.set("description", description);
    start(async () => {
      try {
        setError(null);
        await addRock(teamId, fd);
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
        className="inline-flex items-center gap-1.5 rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40"
      >
        <Plus className="h-4 w-4" />
        New Rock
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
            aria-label="New Rock"
            className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-base font-semibold tracking-tight">
                New Rock
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
                  Title <span className="text-red-500">*</span>
                </span>
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Launch private banking division"
                  required
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  What does done look like?{" "}
                  <span className="font-normal text-zinc-400">(optional)</span>
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short success criterion."
                  rows={4}
                  className="w-full resize-y rounded-md border border-zinc-300 px-3 py-2 text-sm leading-relaxed dark:border-zinc-700 dark:bg-zinc-950"
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
                    <option value={TEAM_OWNER_VALUE}>Team</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                  {ownerId === TEAM_OWNER_VALUE && (
                    <p className="text-[11px] text-zinc-500">
                      Team Rocks appear at the top of the list for everyone.
                    </p>
                  )}
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Quarter
                  </span>
                  <input
                    value={qtr}
                    onChange={(e) => setQtr(e.target.value)}
                    placeholder="e.g. 2026-Q3"
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <p className="text-[11px] text-zinc-500">
                    Free text — calendar Q, fiscal period, or custom label.
                  </p>
                </label>
              </div>

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
                <p className="text-[11px] text-zinc-500">
                  Prefills end of calendar quarter — clear or change as needed.
                </p>
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
                  disabled={pending || !title.trim()}
                  className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {pending ? "Adding…" : "Add Rock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
