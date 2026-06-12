"use client";

// The assessment page's only client island: regenerate + void. Rendered only
// for `complete` assessments (the view enforces that) — failed runs retry
// from the session page, and voided/superseded snapshots are immutable.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { voidAssessment } from "@/app/(swing)/swing/actions";

export function AssessmentActions({
  assessmentId,
  sessionId,
  playerId,
  playerName,
}: {
  assessmentId: string;
  sessionId: string;
  playerId: string;
  playerName: string;
}) {
  const router = useRouter();
  const [regenerating, setRegenerating] = useState(false);
  const regeneratingRef = useRef(false);
  const [voiding, setVoiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    // Synchronous ref guard: React state is async, so a double-click could
    // fire two POSTs before `regenerating` re-renders the button disabled.
    if (regeneratingRef.current) return;
    regeneratingRef.current = true;
    setRegenerating(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : "Couldn't regenerate");
      regeneratingRef.current = false;
      setRegenerating(false);
    }
  }

  async function handleVoid() {
    const confirmed = window.confirm(
      `This removes the assessment from ${playerName}'s record — focus areas revert to the previous assessment. Void it?`
    );
    if (!confirmed) return;
    setVoiding(true);
    setError(null);
    try {
      await voidAssessment(assessmentId);
      router.push(`/swing/players/${playerId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't void the assessment");
      setVoiding(false);
    }
  }

  return (
    <div className="mt-2 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={regenerate}
          disabled={regenerating || voiding}
        >
          {regenerating ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <RotateCcw data-icon="inline-start" />
          )}
          {regenerating ? "Regenerating…" : "Regenerate"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleVoid}
          disabled={regenerating || voiding}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Ban data-icon="inline-start" />
          Void
        </Button>
      </div>
      {regenerating && (
        <p className="mt-2 text-xs text-muted-foreground">
          Re-running the coaching engine on this session&apos;s swings — takes about a
          minute. This version will be kept, marked as replaced.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
