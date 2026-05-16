"use client";

import { useState, useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { solveIssue } from "./actions";

export function SolveButton({
  teamId,
  issueId,
  defaultTitle,
  members,
  currentUserId,
}: {
  teamId: string;
  issueId: string;
  defaultTitle: string;
  members: { user_id: string; full_name: string }[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
      >
        <CheckCheck className="w-4 h-4" />
        Solve
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          await solveIssue(teamId, issueId, fd);
          setOpen(false);
        });
      }}
      className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3"
    >
      <label className="text-xs font-medium text-zinc-700">
        New to-do (due in 7 days):
      </label>
      <input
        name="resolution"
        defaultValue={`Follow up: ${defaultTitle}`}
        autoFocus
        required
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
      />
      <select
        name="todo_owner_id"
        defaultValue={currentUserId}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
      >
        <option value="">— owner —</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.full_name}
          </option>
        ))}
      </select>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-zinc-500 hover:text-zinc-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Solving…" : "Solve & create to-do"}
        </button>
      </div>
    </form>
  );
}
