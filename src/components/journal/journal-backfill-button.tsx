"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listJournalBackfillJobs,
  runJournalBackfillBatch,
} from "@/app/(journal)/settings/family/actions";

// Entries per server round-trip. Small enough that a batch of model calls stays
// well under a request timeout; the client walks the whole list batch by batch.
const BATCH_SIZE = 4;

type Progress = {
  summaryDone: number;
  summaryTotal: number;
  titleDone: number;
  titleTotal: number;
  failed: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function JournalBackfillButton() {
  const [phase, setPhase] = useState<"idle" | "confirm" | "running" | "done">(
    "idle"
  );
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setPhase("running");
    try {
      const { summaryIds, titleIds } = await listJournalBackfillJobs();
      const p: Progress = {
        summaryDone: 0,
        summaryTotal: summaryIds.length,
        titleDone: 0,
        titleTotal: titleIds.length,
        failed: 0,
      };
      setProgress({ ...p });

      for (const batch of chunk(summaryIds, BATCH_SIZE)) {
        const { ok, failed } = await runJournalBackfillBatch("summary", batch);
        p.summaryDone += ok;
        p.failed += failed;
        setProgress({ ...p });
      }
      for (const batch of chunk(titleIds, BATCH_SIZE)) {
        const { ok, failed } = await runJournalBackfillBatch("title", batch);
        p.titleDone += ok;
        p.failed += failed;
        setProgress({ ...p });
      }
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  const running = phase === "running";

  return (
    <div className="mt-2">
      {phase === "idle" && (
        <Button variant="outline" size="sm" onClick={() => setPhase("confirm")}>
          Regenerate all subtitles &amp; titles
        </Button>
      )}

      {phase === "confirm" && (
        <div className="flex items-center gap-3">
          <span className="font-serif text-xs text-muted-foreground">
            Rewrites every closed post&apos;s subtitle and every question
            post&apos;s title, for all members. This can take a while.
          </span>
          <Button variant="default" size="sm" onClick={run}>
            Run it
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPhase("idle")}>
            Cancel
          </Button>
        </div>
      )}

      {(running || phase === "done") && progress && (
        <p className="flex items-center gap-2 font-serif text-xs text-muted-foreground tabular-nums">
          {running && <Loader2 className="size-3.5 animate-spin" />}
          {phase === "done" ? "Done — " : "Working… "}
          subtitles {progress.summaryDone}/{progress.summaryTotal} · titles{" "}
          {progress.titleDone}/{progress.titleTotal}
          {progress.failed > 0 && ` · ${progress.failed} skipped`}
        </p>
      )}

      {error && (
        <p className="mt-1 font-serif text-xs text-destructive">
          Couldn&apos;t finish: {error}
        </p>
      )}
    </div>
  );
}
