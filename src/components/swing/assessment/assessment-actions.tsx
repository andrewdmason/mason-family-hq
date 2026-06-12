"use client";

// The assessment header's overflow menu — every assessment-level action lives
// here: regenerate/void for live assessments, the session link, and (once no
// live assessment remains) deleting the whole session. The server actions are
// the authoritative guards; the menu only chooses what to offer.

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Film, Loader2, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteSession, voidAssessment } from "@/app/(swing)/swing/actions";
import type { AssessmentStatus } from "@/lib/swing/types";

export function AssessmentMenu({
  assessmentId,
  sessionId,
  playerId,
  playerName,
  status,
}: {
  assessmentId: string;
  sessionId: string;
  playerId: string;
  playerName: string;
  status: AssessmentStatus;
}) {
  const router = useRouter();
  const [working, setWorking] = useState<null | "regenerate" | "void" | "delete">(null);
  const workingRef = useRef(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLive = status === "complete";

  async function regenerate() {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking("regenerate");
    setError(null);
    setNote(
      "Re-running the coaching engine on this session's swings — takes about a minute. This version will be kept, marked as replaced."
    );
    try {
      const res = await fetch("/swing/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, mode: "regenerate" }),
      });
      const body = (await res.json().catch(() => null)) as {
        assessmentId?: string;
        error?: string;
      } | null;
      if (!res.ok || !body?.assessmentId) {
        throw new Error(body?.error ?? `Couldn't regenerate (${res.status})`);
      }
      // Stay disabled through the navigation — this page is now superseded.
      router.replace(`/swing/assessments/${body.assessmentId}`);
      router.refresh();
    } catch (err) {
      fail(err, "Couldn't regenerate");
    }
  }

  async function handleVoid() {
    if (workingRef.current) return;
    const confirmed = window.confirm(
      `This removes the assessment from ${playerName}'s record — focus areas revert to the previous assessment. Void it?`
    );
    if (!confirmed) return;
    workingRef.current = true;
    setWorking("void");
    setError(null);
    try {
      await voidAssessment(assessmentId);
      router.push(`/swing/players/${playerId}`);
      router.refresh();
    } catch (err) {
      fail(err, "Couldn't void the assessment");
    }
  }

  async function handleDeleteSession() {
    if (workingRef.current) return;
    const confirmed = window.confirm(
      "Delete this whole session? Its clips, extracted data, stills, and this assessment record are removed permanently."
    );
    if (!confirmed) return;
    workingRef.current = true;
    setWorking("delete");
    setError(null);
    try {
      await deleteSession(sessionId);
      router.push(`/swing/players/${playerId}`);
      router.refresh();
    } catch (err) {
      fail(err, "Couldn't delete the session");
    }
  }

  function fail(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
    setNote(null);
    workingRef.current = false;
    setWorking(null);
  }

  return (
    <div className="flex flex-col items-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Assessment options"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent"
          disabled={working !== null}
        >
          {working ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <MoreHorizontal className="size-5" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-52">
          {isLive && (
            <>
              <DropdownMenuItem onClick={regenerate}>
                <RotateCcw data-icon="inline-start" />
                Regenerate assessment
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleVoid} variant="destructive">
                <Ban data-icon="inline-start" />
                Void assessment
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            render={<Link href={`/swing/players/${playerId}/sessions/${sessionId}`} />}
          >
            <Film data-icon="inline-start" />
            Open session
          </DropdownMenuItem>
          {!isLive && status !== "generating" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleDeleteSession} variant="destructive">
                <Trash2 data-icon="inline-start" />
                Delete session…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {note && working === "regenerate" && (
        <p className="mt-1 max-w-60 text-right text-xs text-muted-foreground">{note}</p>
      )}
      {error && <p className="mt-1 max-w-60 text-right text-xs text-red-500">{error}</p>}
    </div>
  );
}
