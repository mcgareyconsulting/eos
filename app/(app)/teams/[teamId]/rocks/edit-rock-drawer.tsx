"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { updateRockMeta } from "./actions";
import { TEAM_OWNER_VALUE } from "./rock-type";
import {
  MilestonesDisclosure,
  type MilestoneSerialized,
} from "./milestones";

type Member = { user_id: string; full_name: string };

export function EditRockDrawer({
  teamId,
  rock,
  members,
  milestones,
  defaultDue,
}: {
  teamId: string;
  rock: {
    id: string;
    title: string;
    description: string | null;
    owner_id: string | null;
    quarter: string;
    due_date: string | null;
  };
  members: Member[];
  milestones: MilestoneSerialized[];
  defaultDue: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(rock.title);
  const [description, setDescription] = useState(rock.description ?? "");
  const [ownerId, setOwnerId] = useState(rock.owner_id ?? TEAM_OWNER_VALUE);
  const [quarter, setQuarter] = useState(rock.quarter);
  const [due, setDue] = useState(rock.due_date ?? "");

  // Reset drafts when opening so cancelled edits don't leak.
  useEffect(() => {
    if (!open) return;
    setTitle(rock.title);
    setDescription(rock.description ?? "");
    setOwnerId(rock.owner_id ?? TEAM_OWNER_VALUE);
    setQuarter(rock.quarter);
    setDue(rock.due_date ?? "");
    setError(null);
  }, [open, rock]);

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
    fd.set("description", description);
    fd.set("owner_id", ownerId);
    fd.set("quarter", quarter);
    fd.set("due_date", due);
    start(async () => {
      try {
        setError(null);
        await updateRockMeta(teamId, rock.id, fd);
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
        onClick={() => setOpen(true)}
        title="Edit rock"
        className="rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <Pencil className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Edit rock"
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-zinc-300 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <header className="flex items-center justify-between border-b border-zinc-300 px-5 py-4 dark:border-zinc-800">
              <h2 className="text-base font-semibold">Edit rock</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <form
              onSubmit={submit}
              className="flex flex-1 flex-col overflow-y-auto"
            >
              <div className="space-y-4 px-5 py-4">
                <Field label="Title" required>
                  <input
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </Field>

                <Field label="Description">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does done look like?"
                    rows={4}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-hpb-blue/30 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Owner">
                    <select
                      value={ownerId}
                      onChange={(e) => setOwnerId(e.target.value)}
                      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value={TEAM_OWNER_VALUE}>Team</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Quarter">
                    <input
                      value={quarter}
                      onChange={(e) => setQuarter(e.target.value)}
                      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </Field>
                </div>

                <Field label="Due date">
                  <input
                    type="date"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </Field>

                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <MilestonesDisclosure
                    teamId={teamId}
                    rockId={rock.id}
                    rockOwnerId={rock.owner_id}
                    members={members}
                    milestones={milestones}
                    defaultDue={defaultDue}
                    alwaysOpen
                  />
                </div>

                {error && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}
              </div>

              <footer className="mt-auto flex items-center justify-end gap-2 border-t border-zinc-300 px-5 py-3 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending || !title.trim()}
                  className="rounded-md bg-hpb-blue px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </>
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
