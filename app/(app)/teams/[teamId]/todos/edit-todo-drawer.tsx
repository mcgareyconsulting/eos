"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { updateTodoMeta } from "./actions";

type Member = { user_id: string; full_name: string };

export function EditTodoDrawer({
  teamId,
  todo,
  members,
}: {
  teamId: string;
  todo: {
    id: string;
    title: string;
    description: string | null;
    owner_id: string | null;
    due_date: string | null;
    visibility: "team" | "private";
  };
  members: Member[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const defaultOwner = todo.owner_id ?? members[0]?.user_id ?? "";
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? "");
  const [ownerId, setOwnerId] = useState(defaultOwner);
  const [due, setDue] = useState(todo.due_date ?? "");
  const [visibility, setVisibility] = useState<"team" | "private">(
    todo.visibility,
  );

  useEffect(() => {
    if (!open) return;
    setTitle(todo.title);
    setDescription(todo.description ?? "");
    setOwnerId(todo.owner_id ?? members[0]?.user_id ?? "");
    setDue(todo.due_date ?? "");
    setVisibility(todo.visibility);
    setError(null);
  }, [open, todo, members]);

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
    fd.set("due_date", due);
    fd.set("visibility", visibility);
    start(async () => {
      try {
        setError(null);
        await updateTodoMeta(teamId, todo.id, fd);
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
        title="Edit to-do"
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
            aria-label="Edit to-do"
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-zinc-300 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <header className="flex items-center justify-between border-b border-zinc-300 px-5 py-4 dark:border-zinc-800">
              <h2 className="text-base font-semibold">Edit to-do</h2>
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
                    placeholder="Notes or context"
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
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Visibility">
                    <select
                      value={visibility}
                      onChange={(e) =>
                        setVisibility(e.target.value as "team" | "private")
                      }
                      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="team">Team</option>
                      <option value="private">Private</option>
                    </select>
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
