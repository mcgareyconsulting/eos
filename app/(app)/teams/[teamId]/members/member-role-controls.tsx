"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setMemberRole } from "./actions";

/**
 * Leader-only promote / demote for one roster row.
 * Demoting the last leader is blocked server-side; we still hide the demote
 * button when `canDemote` is false so the UI doesn't tease a failing click.
 */
export function MemberRoleControls({
  teamId,
  userId,
  role,
  isSelf,
  canDemote,
}: {
  teamId: string;
  userId: string;
  role: string;
  isSelf: boolean;
  /** False when this is the only leader on the team. */
  canDemote: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isLeader = role === "leader";

  function run(next: "leader" | "member") {
    setError(null);
    start(async () => {
      try {
        await setMemberRole(teamId, userId, next);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            isLeader
              ? "bg-hpb-blue/10 text-hpb-blue ring-hpb-blue/20 dark:text-hpb-gold dark:ring-hpb-gold/20"
              : "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
          }`}
        >
          {isLeader ? "Leader" : "Member"}
        </span>

        {isLeader ? (
          <button
            type="button"
            disabled={pending || !canDemote}
            title={
              !canDemote
                ? "Promote another leader before demoting the last one"
                : isSelf
                  ? "Remove your own leader access"
                  : "Make member"
            }
            onClick={() => {
              if (
                !window.confirm(
                  isSelf
                    ? "Remove your leader access on this team? You will lose Members admin until another leader promotes you again."
                    : "Demote this person to member? They will lose Members admin on this team.",
                )
              ) {
                return;
              }
              run("member");
            }}
            className="inline-flex min-w-[5.5rem] items-center justify-center rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Make member"
            )}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  "Promote this person to leader? They will be able to manage members and meeting settings.",
                )
              ) {
                return;
              }
              run("leader");
            }}
            className="inline-flex min-w-[5.5rem] items-center justify-center rounded-md bg-hpb-blue px-2 py-1 text-xs font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Make leader"
            )}
          </button>
        )}
      </div>
      {error && (
        <p className="max-w-[16rem] text-right text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
