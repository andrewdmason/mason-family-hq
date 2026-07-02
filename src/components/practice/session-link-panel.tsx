"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, Link2Icon, Loader2Icon, RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptLinkProposal, reprocessSession } from "@/app/practice/session/link-actions";
import type { PracticeSessionLinkStatus, PracticeSessionStatus } from "@/lib/types";

function fmt(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export type LinkProposal = {
  key: string;
  pieceName: string;
  startSec: number;
  endSec: number;
  region: string | null;
  confidence: number;
};

export type AcceptedDisplay = {
  key: string;
  pieceName: string;
  startSec: number;
  endSec: number;
};

/**
 * The "link to pieces" flow on a session's detail page (plan U8, F4/R16).
 * The button kicks off a background recognition job via the process route's
 * `link: true` flag and is disabled while `link_status` is 'linking' (the
 * result lands via callback + revalidation — revisit or refresh to see it; no
 * blocking poll). Proposals come from result.segments; Accept writes one
 * ordinary completed task (KTD9) and Reject is a local dismiss only — a
 * re-link re-proposes it, and accepted entries are never touched.
 */
export function SessionLinkPanel({
  sessionId,
  status,
  errorMessage,
  linkStatus,
  linkError,
  canLink,
  proposals,
  accepted,
}: {
  sessionId: string;
  status: PracticeSessionStatus;
  errorMessage: string | null;
  linkStatus: PracticeSessionLinkStatus;
  linkError: string | null;
  /** ready + audio kept — pre-U8 sessions whose audio was deleted can't link. */
  canLink: boolean;
  proposals: LinkProposal[];
  accepted: AcceptedDisplay[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null); // "link" | "reprocess" | proposal key
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const linking = linkStatus === "linking";
  const visibleProposals = proposals.filter((p) => !dismissed.has(p.key));

  async function startLink() {
    setPending("link");
    setActionError(null);
    try {
      const res = await fetch("/practice/session/api/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, link: true }),
      });
      const data = await res.json();
      if (!res.ok || data.status === "failed") {
        throw new Error(data.error ?? "Couldn't start linking");
      }
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't start linking");
    } finally {
      setPending(null);
    }
  }

  async function reprocess() {
    setPending("reprocess");
    setActionError(null);
    const res = await reprocessSession(sessionId);
    setPending(null);
    if (!res.ok) setActionError(res.error ?? "Couldn't reprocess");
    else router.refresh();
  }

  async function accept(key: string) {
    setPending(key);
    setActionError(null);
    const res = await acceptLinkProposal(sessionId, key);
    setPending(null);
    if (!res.ok) setActionError(res.error ?? "Couldn't log the entry");
    else router.refresh();
  }

  return (
    <div className="mb-6 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        {status === "failed" ? (
          <>
            <span className="text-sm text-destructive">
              Transcription failed{errorMessage ? `: ${errorMessage}` : ""} — the
              audio is kept.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={reprocess}
              disabled={pending !== null}
            >
              {pending === "reprocess" ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RotateCcwIcon />
              )}
              Reprocess
            </Button>
          </>
        ) : canLink ? (
          <>
            <Button
              size="sm"
              onClick={startLink}
              disabled={linking || pending !== null}
            >
              {linking || pending === "link" ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <Link2Icon />
              )}
              {linking
                ? "Linking…"
                : linkStatus === "failed"
                  ? "Retry link"
                  : linkStatus === "linked"
                    ? "Re-link to pieces"
                    : "Link to pieces"}
            </Button>
            {linking && (
              <span className="text-xs text-muted-foreground">
                Recognizing pieces in the background — check back in a couple of
                minutes.
              </span>
            )}
            {linkStatus === "failed" && !linking && (
              <span className="text-xs text-muted-foreground">
                Linking didn&apos;t work{linkError ? ` (${linkError})` : ""} — the
                session is unaffected.
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {status === "ready"
              ? "This session's audio wasn't retained, so it can't be linked to pieces."
              : "Transcribing in the background — linking becomes available once the session is ready."}
          </span>
        )}
        {actionError && <span className="text-xs text-destructive">{actionError}</span>}
      </div>

      {visibleProposals.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            Proposed entries
          </h2>
          <div className="divide-y rounded-lg border">
            {visibleProposals.map((p) => (
              <div key={p.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{p.pieceName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {fmt(p.startSec)}–{fmt(p.endSec)}
                    {p.region ? ` · ${p.region}` : ""} ·{" "}
                    {Math.round(p.confidence * 100)}%
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => accept(p.key)}
                  disabled={pending !== null}
                >
                  {pending === p.key ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <CheckIcon />
                  )}
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDismissed((d) => new Set(d).add(p.key))
                  }
                  disabled={pending !== null}
                  aria-label="Reject proposal"
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {accepted.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            Logged from this session
          </h2>
          <div className="divide-y rounded-lg border">
            {accepted.map((a) => (
              <div key={a.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                <CheckIcon className="size-3.5 text-green-600 dark:text-green-500" />
                <span className="font-medium">{a.pieceName}</span>
                <span className="text-xs text-muted-foreground">
                  {fmt(a.startSec)}–{fmt(a.endSec)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
