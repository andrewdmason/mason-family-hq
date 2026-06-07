"use client";

import { useTransition } from "react";
import { resendToWhoop } from "@/app/(workouts)/workouts/actions";

type Status = "synced" | "dirty" | "failed" | "syncing" | null;

/**
 * Shows where a completed session stands with WHOOP and offers a re-send. Only
 * rendered once a session is complete (an incomplete session hasn't pushed).
 * `connected` reflects whether a WHOOP connection exists at all — without one
 * there's nothing to show.
 */
export function WhoopSyncChip({
  sessionId,
  connected,
  status,
  syncedAt,
  error,
}: {
  sessionId: string;
  connected: boolean;
  status: Status;
  syncedAt: string | null;
  error: string | null;
}) {
  const [pending, startTransition] = useTransition();
  if (!connected) return null;

  const resend = () => startTransition(async () => void (await resendToWhoop(sessionId)));

  const base = "inline-flex items-center gap-1.5 font-serif text-xs";

  if (pending || status === "syncing") {
    return <span className={`${base} text-muted-foreground`}>Sending to WHOOP…</span>;
  }

  if (status === "synced") {
    return (
      <span className={`${base} text-muted-foreground`}>
        <span className="text-emerald-600">✓</span> Sent to WHOOP
        {syncedAt && <span className="text-muted-foreground/70"> · {syncedAt.slice(0, 10)}</span>}
        <button
          type="button"
          onClick={resend}
          className="text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
        >
          Send again
        </button>
      </span>
    );
  }

  if (status === "dirty") {
    return (
      <button type="button" onClick={resend} className={`${base} text-amber-700 hover:underline`}>
        Edited since last sync — re-send to WHOOP
      </button>
    );
  }

  if (status === "failed") {
    return (
      <span className={`${base} text-red-600`}>
        <button type="button" onClick={resend} className="hover:underline">
          WHOOP sync failed — retry
        </button>
        {error && <span className="text-muted-foreground/70" title={error}> · why?</span>}
      </span>
    );
  }

  // Connected, complete, but never pushed (e.g. completed before connecting).
  return (
    <button type="button" onClick={resend} className={`${base} text-muted-foreground hover:underline`}>
      Send to WHOOP
    </button>
  );
}
