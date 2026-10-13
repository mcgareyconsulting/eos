"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { ActivityFeed } from "@/components/activity-feed";
import { ConfirmSubmitForm } from "@/components/confirm-submit-form";
import { DetailShell } from "@/components/detail-shell";
import { LocalTime } from "@/components/local-time";
import { RichText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { DiscardChangesDialog, useDiscardGuard } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { deleteHeadline, setHeadlineArchived } from "./actions";
import { HeadlineDiscussedCheckbox } from "./headline-checkbox";
import {
  headlineActions,
  headlineAudienceLabel,
  headlineFeedEvents,
  type HeadlineDetailData,
  type HeadlineSurface,
} from "./headline-detail";
import { HeadlineFormModal } from "./headline-form-modal";
import { headlineKind } from "./headline-kind";

type Member = { user_id: string; full_name: string };

const WHEN: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

const DAY: Intl.DateTimeFormatOptions = {
  month: "numeric",
  day: "numeric",
  year: "numeric",
};

/** Opens the detail for a headline id; null outside a provider. */
const OpenHeadline = createContext<((id: string) => void) | null>(null);

type ProviderProps = {
  teamId: string;
  userId: string;
  members: Member[];
  /** Every headline a row on this surface can open, active and archived. */
  headlines: readonly HeadlineDetailData[];
  surface: HeadlineSurface;
  /**
   * Open on arrival when the URL says `?headline=<id>` (the link a
   * notification carries, lib/item-registry.ts). The Headlines tab only.
   */
  deepLink?: boolean;
  children: ReactNode;
};

/**
 * Holds which headline's detail is open and renders that one modal, once,
 * beside the list rather than inside a row. Rows open it through
 * `HeadlineDetailTrigger`.
 *
 * Why not one modal per row (as IssueDetailTrigger does):
 * - the row can go away under an open modal — archiving moves it to the
 *   other tab, and the L10 re-sorts and regroups rows live — and the modal
 *   would unmount with it;
 * - React events bubble through portals along the component tree, so a
 *   modal rendered inside a row's button would send every click inside it
 *   to that button, and a row's `group-hover` cluster fades its subtree
 *   (the P10 edit-modal lesson);
 * - the server page would otherwise serialise the roster once per row.
 *
 * The modal reads its headline from `headlines` on each render, so it
 * follows the live listener (L10) or the revalidated props (Headlines tab),
 * and disappears on its own when the headline is deleted.
 */
export function HeadlineDetailProvider(props: ProviderProps) {
  return props.deepLink ? (
    <LinkedProvider {...props} />
  ) : (
    <ProviderInner {...props} initialId={null} />
  );
}

function LinkedProvider(props: ProviderProps) {
  const linked = useSearchParams().get("headline");
  return <ProviderInner {...props} initialId={linked} />;
}

function ProviderInner({
  teamId,
  userId,
  members,
  headlines,
  surface,
  initialId,
  children,
}: ProviderProps & { initialId: string | null }) {
  const [openId, setOpenId] = useState<string | null>(initialId);
  const open = openId ? headlines.find((h) => h.id === openId) : undefined;

  return (
    <OpenHeadline.Provider value={setOpenId}>
      {children}
      {open && (
        <HeadlineDetailModal
          // A different headline starts with a fresh composer and guard.
          key={open.id}
          headline={open}
          teamId={teamId}
          userId={userId}
          members={members}
          surface={surface}
          onClose={() => setOpenId(null)}
        />
      )}
    </OpenHeadline.Provider>
  );
}

/**
 * The clickable part of a headline row (title, pills, one-line preview).
 * Opens the detail via the surrounding `HeadlineDetailProvider`.
 */
export function HeadlineDetailTrigger({
  headlineId,
  className,
  children,
}: {
  headlineId: string;
  className?: string;
  children: ReactNode;
}) {
  const open = useContext(OpenHeadline);
  return (
    <button
      type="button"
      onClick={() => open?.(headlineId)}
      title="Open headline"
      className={cn(
        "block w-full min-w-0 cursor-pointer rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-hpb-blue/40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * A headline in full: title, category, audience, owner, date and the whole
 * description on the left with the row's own actions; its ActivityFeed
 * (comments, plus what the headline's fields prove — see
 * headlineFeedEvents) on the right.
 */
export function HeadlineDetailModal({
  headline: h,
  teamId,
  userId,
  members,
  surface,
  onClose,
}: {
  headline: HeadlineDetailData;
  teamId: string;
  userId: string;
  members: Member[];
  surface: HeadlineSurface;
  onClose: () => void;
}) {
  const kind = headlineKind(h.kind);
  const archived = h.archivedMs != null;
  const actions = headlineActions(h, surface);

  // An unsent comment asks before the modal closes, like any other form.
  const [hasDraft, setHasDraft] = useState(false);
  const guard = useDiscardGuard(hasDraft, onClose);

  const events = useMemo(
    () =>
      headlineFeedEvents(
        h,
        (id) => members.find((m) => m.user_id === id)?.full_name,
      ),
    [h, members],
  );

  const [archivePending, startArchive] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);
  function toggleArchive() {
    startArchive(async () => {
      try {
        setArchiveError(null);
        await setHeadlineArchived(teamId, h.id, !archived);
      } catch (err) {
        setArchiveError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <DetailShell
        ariaLabel={`Headline: ${h.title}`}
        onClose={guard.requestClose}
        // Escape and the backdrop belong to the discard confirm while it is up.
        dismissible={!guard.asking}
        aside={
          <ActivityFeed
            teamId={teamId}
            entityType="headline"
            entityId={h.id}
            userId={userId}
            members={members}
            events={events}
            onDraftChange={setHasDraft}
          />
        }
      >
        <div className="space-y-6">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", kind.dotClassName)}
                  aria-hidden
                />
                {kind.label}
              </span>
              {h.discussed && !archived && <Pill>Discussed · closes Monday</Pill>}
              {archived && (
                <Pill>
                  Closed on <LocalTime ms={h.archivedMs} options={DAY} />
                </Pill>
              )}
              {h.broadcast && <Pill>Org-wide · text is read-only</Pill>}
            </div>
            <h2 className="text-lg font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
              {h.title}
            </h2>
          </header>

          <dl className="grid grid-cols-1 gap-4 rounded-lg border border-zinc-200 bg-zinc-50/80 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950/40 sm:grid-cols-3">
            <Field label="Audience">{headlineAudienceLabel(h)}</Field>
            <Field label="Owner">{h.ownerLabel}</Field>
            <Field label="Posted">
              <LocalTime ms={h.createdMs} options={WHEN} />
            </Field>
          </dl>

          <section aria-label="Description" className="space-y-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Detail
            </h3>
            {h.body ? (
              <RichText
                value={h.body}
                className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
              />
            ) : (
              <p className="text-sm italic text-zinc-400">No detail.</p>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {actions.discussed && (
              // The checkbox carries a row's mt-1; centred here instead.
              <label className="mr-2 inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 [&>input]:mt-0">
                <HeadlineDiscussedCheckbox
                  teamId={teamId}
                  headlineId={h.id}
                  discussed={h.discussed}
                />
                <span>Discussed</span>
              </label>
            )}
            {actions.edit && (
              <HeadlineFormModal
                mode="edit"
                trigger="button"
                teamId={teamId}
                headline={{
                  id: h.id,
                  title: h.title,
                  body: h.body,
                  kind: h.kind,
                }}
              />
            )}
            {actions.archive && (
              <Button
                variant="outline"
                onClick={toggleArchive}
                disabled={archivePending}
              >
                {archived ? (
                  <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Archive className="h-3.5 w-3.5" aria-hidden />
                )}
                {archived ? "Restore" : "Archive now"}
              </Button>
            )}
            {actions.delete && (
              <ConfirmSubmitForm
                action={deleteHeadline.bind(null, teamId, h.id)}
                title="Delete headline?"
                confirmLabel="Delete headline"
                confirmMessage="Delete this headline? This can't be undone."
                className="ml-auto"
              >
                <Button
                  type="submit"
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Delete
                </Button>
              </ConfirmSubmitForm>
            )}
          </div>
          {archiveError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {archiveError}
            </p>
          )}
        </div>
      </DetailShell>

      <DiscardChangesDialog
        open={guard.asking}
        onKeepEditing={guard.keepEditing}
        onDiscard={guard.discard}
        title="Discard your comment?"
        discardLabel="Discard comment"
        message="You have a comment you haven't posted. Close now and it's gone."
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-zinc-800 dark:text-zinc-200">
        {children}
      </dd>
    </div>
  );
}
