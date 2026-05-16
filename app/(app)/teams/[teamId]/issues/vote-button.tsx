"use client";

import { useTransition } from "react";
import { ArrowBigUp } from "lucide-react";
import { voteIssue } from "./actions";

export function VoteButton({
  teamId,
  issueId,
  votes,
}: {
  teamId: string;
  issueId: string;
  votes: number;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => voteIssue(teamId, issueId, 1))}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
      title="Upvote"
    >
      <ArrowBigUp className="w-4 h-4" />
      {votes}
    </button>
  );
}
