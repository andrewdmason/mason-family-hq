"use client";

// Session flow orchestrator (F1 front half): add clips → serial in-browser
// extraction → incremental artifact persistence → Analyze.
//
// Persistence discipline: each clip's artifacts upload the moment that clip
// finishes (a closed tab costs at most one clip). Artifacts are held in
// memory for the life of the tab — upload retry never re-extracts; a refresh
// means re-adding the file, which the hash upsert makes safe.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Film,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  deleteClip,
  deleteSession,
  excludeClip,
  issueClipArtifactUploads,
  recordClipExtracted,
  recordClipRejected,
  updateSessionFilmedOn,
} from "@/app/(swing)/swing/actions";
import { uploadClipArtifacts } from "@/lib/swing/artifact-upload";
import {
  extractInBrowser,
  fingerprintFile,
  type ClientExtraction,
} from "@/lib/swing/extraction-client";
import { HIGH_SPEED_FPS_THRESHOLD } from "@/lib/swing/pipeline/frame-source";
import {
  MIN_USABLE_CLIPS,
  type SwingClip,
  type SwingPlayer,
  type SwingSession,
} from "@/lib/swing/types";

type JobStatus =
  | { kind: "queued" }
  | { kind: "fingerprinting" }
  | { kind: "extracting"; stage: string; done: number; total: number }
  | { kind: "uploading" }
  | { kind: "done" }
  | { kind: "duplicate" }
  | { kind: "rejected"; message: string }
  | { kind: "upload_failed"; message: string };

interface Job {
  id: string;
  file: File;
  status: JobStatus;
  warnings: string[];
  /** Held for in-tab upload retry. */
  extraction?: Extract<ClientExtraction, { ok: true }>;
  contentHash?: string;
}

export function SessionShell({
  player,
  session,
  initialClips,
  latestAssessment,
}: {
  player: SwingPlayer;
  session: SwingSession;
  initialClips: SwingClip[];
  latestAssessment: { id: string; status: string } | null;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const analyzingRef = useRef(false);
  const processing = useRef(false);
  // Only terminal clips are duplicates — pending/extracting rows must stay
  // re-addable (re-adding the same file is the documented resume path).
  const knownHashes = useRef(
    new Set(
      initialClips
        .filter((c) => c.status === "ok" || c.status === "rejected")
        .map((c) => c.contentHash)
    )
  );

  const okClips = initialClips.filter((c) => c.status === "ok");
  const ready = okClips.length >= MIN_USABLE_CLIPS;

  const busy = jobs.some((j) =>
    ["queued", "fingerprinting", "extracting", "uploading"].includes(j.status.kind)
  );

  /* ------------------------------------------------ analyzing wait state - */
  useEffect(() => {
    if (session.status !== "analyzing") return;
    const interval = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(interval);
  }, [session.status, router]);

  useEffect(() => {
    if (busy) return; // don't yank the page away while clips are in flight
    if (session.status === "complete" && latestAssessment?.status === "complete") {
      router.replace(`/swing/assessments/${latestAssessment.id}`);
    }
  }, [session.status, latestAssessment?.id, latestAssessment?.status, busy, router]);

  /* --------------------------------------------------------- wake lock --- */
  useEffect(() => {
    if (!busy || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // best effort — low battery etc.
      }
    };
    const onVisibility = () => {
      // The lock auto-releases on tab hide; re-acquire when we're back.
      if (document.visibilityState === "visible" && !released) acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release().catch(() => {});
    };
  }, [busy]);

  /* ------------------------------------------------------ serial queue --- */
  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const processJob = useCallback(
    async (job: Job) => {
      updateJob(job.id, { status: { kind: "fingerprinting" } });
      const contentHash = await fingerprintFile(job.file);
      updateJob(job.id, { contentHash });

      if (knownHashes.current.has(contentHash)) {
        updateJob(job.id, { status: { kind: "duplicate" } });
        return;
      }
      knownHashes.current.add(contentHash);

      const filmedAt =
        job.file.lastModified > 0 ? new Date(job.file.lastModified).toISOString() : null;

      updateJob(job.id, {
        status: { kind: "extracting", stage: "decoding", done: 0, total: 1 },
      });
      const result = await extractInBrowser(job.file, {
        onProgress: (p) =>
          updateJob(job.id, {
            status: { kind: "extracting", stage: p.stage, done: p.done, total: p.total },
          }),
      });

      // Baked slo-mo exports (AirDrop renders 240fps as a stretched 30fps
      // file) are handled by the pipeline and warn through its own message;
      // this warning is only for TRUE real-time low-fps captures.
      const isBakedSlowMotion = result.ok && result.slowMotionFactor > 1;
      const fpsWarning =
        !isBakedSlowMotion &&
        result.probe?.trackFps != null &&
        result.probe.trackFps < HIGH_SPEED_FPS_THRESHOLD
          ? [
              `This clip is ~${Math.round(result.probe.trackFps)}fps. If it was filmed in regular speed (not slo-mo), timing reads are less precise — film with 240fps slo-mo for the sharpest analysis.`,
            ]
          : [];

      if (!result.ok) {
        updateJob(job.id, {
          status: { kind: "rejected", message: result.rejectionMessage },
          warnings: [...fpsWarning, ...result.warnings],
        });
        await recordClipRejected(session.id, {
          contentHash,
          fileName: job.file.name,
          reason: result.rejectionMessage,
          sourceFps: result.probe?.trackFps ?? null,
          durationSeconds: result.probe?.durationSeconds ?? null,
          filmedAt,
        });
        router.refresh();
        return;
      }

      updateJob(job.id, {
        extraction: result,
        warnings: [...fpsWarning, ...result.warnings],
        status: { kind: "uploading" },
      });
      await persistExtraction(job.id, contentHash, job.file, result, filmedAt);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.id, router, updateJob]
  );

  const persistExtraction = useCallback(
    async (
      jobId: string,
      contentHash: string,
      file: File,
      extraction: Extract<ClientExtraction, { ok: true }>,
      filmedAt: string | null
    ) => {
      try {
        const grant = await issueClipArtifactUploads(session.id, {
          contentHash,
          fileName: file.name,
          stills: extraction.stills.map((s) => ({
            phase: s.phase,
            contentType: s.contentType,
            annotations: s.annotations,
          })),
        });
        if (grant.kind === "already_done") {
          updateJob(jobId, { status: { kind: "duplicate" } });
          return;
        }
        await uploadClipArtifacts(grant, {
          keypointsGzip: extraction.keypointsGzip,
          stills: extraction.stills,
        });
        await recordClipExtracted(grant.clipId, {
          events: extraction.events,
          metrics: extraction.metrics,
          detectedBats: extraction.detectedBats,
          hitterHeight: extraction.heightNorm,
          sourceFps: extraction.probe.trackFps,
          durationSeconds: extraction.probe.durationSeconds,
          filmedAt,
        });
        updateJob(jobId, { status: { kind: "done" } });
        router.refresh();
      } catch (error) {
        updateJob(jobId, {
          status: {
            kind: "upload_failed",
            message: error instanceof Error ? error.message : "Upload failed",
          },
        });
      }
    },
    [session.id, router, updateJob]
  );

  // Serial by design: parallel extraction contends for the GPU delegate and
  // OOMs phones; serial keeps progress legible. pendingRef is the queue;
  // state is just the render mirror.
  const pendingRef = useRef<Job[]>([]);
  // Ref-indirection so the long-lived pump loop always calls the latest
  // processJob (a stale closure would pin old session/router references).
  const processJobRef = useRef(processJob);
  processJobRef.current = processJob;
  const pump = useCallback(async () => {
    if (processing.current) return;
    processing.current = true;
    try {
      for (;;) {
        const next = pendingRef.current.shift();
        if (!next) break;
        try {
          await processJobRef.current(next);
        } catch (error) {
          updateJob(next.id, {
            status: {
              kind: "rejected",
              message:
                error instanceof Error ? error.message : "Something went wrong with this clip",
            },
          });
        }
      }
    } finally {
      processing.current = false;
    }
  }, [updateJob]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const newJobs: Job[] = [...files]
        .filter((f) => f.type.startsWith("video/") || /\.(mov|mp4|m4v)$/i.test(f.name))
        .map((file) => ({
          id: crypto.randomUUID(),
          file,
          status: { kind: "queued" as const },
          warnings: [],
        }));
      if (newJobs.length === 0) return;
      setJobs((prev) => [...prev, ...newJobs]);
      pendingRef.current.push(...newJobs);
      void pump();
    },
    [pump]
  );

  const retryUpload = useCallback(
    (job: Job) => {
      if (!job.extraction || !job.contentHash) return;
      updateJob(job.id, { status: { kind: "uploading" } });
      const filmedAt =
        job.file.lastModified > 0 ? new Date(job.file.lastModified).toISOString() : null;
      persistExtraction(job.id, job.contentHash, job.file, job.extraction, filmedAt);
    },
    [persistExtraction, updateJob]
  );

  /* ------------------------------------------------------------ derived -- */
  /* ------------------------------------------------- clearing errors ----- */
  // Rejected and interrupted rows block re-adding the same file (their hash
  // still occupies the session slot). Removing them frees the slot so the
  // coach can clear errors and re-run by re-adding the files.
  const errorClips = initialClips.filter(
    (c) => c.status === "rejected" || c.status === "extracting" || c.status === "pending"
  );

  const removeClip = useCallback(
    async (clip: SwingClip) => {
      try {
        await deleteClip(clip.id);
        knownHashes.current.delete(clip.contentHash);
        // Drop any finished local job for the same file so the list resets too.
        setJobs((prev) => prev.filter((j) => j.contentHash !== clip.contentHash));
        router.refresh();
      } catch (error) {
        console.error("Couldn't remove clip:", error);
        window.alert(error instanceof Error ? error.message : "Couldn't remove clip");
      }
    },
    [router]
  );

  const clearAllErrors = useCallback(async () => {
    for (const clip of errorClips) {
      try {
        await deleteClip(clip.id);
        knownHashes.current.delete(clip.contentHash);
      } catch (error) {
        console.error("Couldn't remove clip:", error);
      }
    }
    setJobs((prev) =>
      prev.filter(
        (j) => !["duplicate", "rejected", "upload_failed"].includes(j.status.kind)
      )
    );
    router.refresh();
  }, [errorClips, router]);

  const dismissJob = useCallback((job: Job) => {
    if (job.contentHash) knownHashes.current.delete(job.contentHash);
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
  }, []);

  const dateSpanWarning = useMemo(() => {
    const dates = initialClips
      .map((c) => c.filmedAt)
      .filter((d): d is string => d !== null)
      .map((d) => d.slice(0, 10));
    return new Set(dates).size > 1;
  }, [initialClips]);

  const handednessMismatch = okClips.some(
    (c) => c.detectedBats !== null && c.detectedBats !== player.bats
  );

  const heightOutliers = useMemo(() => {
    const heights = okClips
      .map((c) => c.hitterHeight)
      .filter((h): h is number => h !== null);
    if (heights.length < 3) return new Set<string>();
    const sorted = [...heights].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return new Set(
      okClips
        .filter(
          (c) => c.hitterHeight !== null && Math.abs(c.hitterHeight - median) / median > 0.25
        )
        .map((c) => c.id)
    );
  }, [okClips]);

  async function startAnalyze() {
    // Synchronous ref guard: React state is async, so a double-click could
    // fire two POSTs before `analyzing` re-renders the button disabled.
    if (analyzingRef.current || busy) return;
    analyzingRef.current = true;
    setAnalyzing(true);
    setAnalyzeError(null);
    // The route can legitimately run for minutes (maxDuration 300s) — give it
    // a little headroom, then stop waiting client-side.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 330_000);
    try {
      const res = await fetch("/swing/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Analysis failed to start (${res.status})`);
      }
      router.refresh();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setAnalyzeError(
          "Analysis is running on the server — check back in a minute."
        );
      } else {
        setAnalyzeError(error instanceof Error ? error.message : "Couldn't start analysis");
      }
    } finally {
      clearTimeout(timeout);
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  }

  /* ----------------------------------------------------------- analyzing - */
  if (session.status === "analyzing") {
    return (
      <CenteredState
        icon={<Loader2 className="size-8 animate-spin text-sky-600" />}
        title="Generating assessment…"
        body="This takes about a minute. You can close this tab — the assessment finishes on the server and will be here when you come back."
      />
    );
  }
  if (session.status === "complete" && latestAssessment) {
    return (
      <CenteredState
        icon={<Check className="size-8 text-green-600" />}
        title="Assessment ready"
        body=""
        action={
          <Button onClick={() => router.push(`/swing/assessments/${latestAssessment.id}`)}>
            View assessment
          </Button>
        }
      />
    );
  }
  if (session.status === "analysis_failed") {
    return (
      <CenteredState
        icon={<AlertTriangle className="size-8 text-amber-600" />}
        title="Analysis failed"
        body={session.error ?? "The coaching engine hit a problem. Your clips are safe — retry runs from stored data, nothing re-uploads."}
        action={
          <Button onClick={startAnalyze} disabled={analyzing}>
            <RotateCcw data-icon="inline-start" />
            Retry analysis
          </Button>
        }
      />
    );
  }

  /* --------------------------------------------------------------- draft - */
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <header className="mb-4">
        <h1 className="font-serif text-2xl tracking-tight">
          Session — {player.name}
        </h1>
        <label className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4" />
          Filmed
          <input
            type="date"
            defaultValue={session.filmedOn}
            className="rounded border border-input bg-transparent px-1.5 py-0.5 text-sm"
            onChange={(e) => {
              if (e.target.value) {
                updateSessionFilmedOn(session.id, e.target.value)
                  .then(() => router.refresh())
                  .catch((err) => console.error("Couldn't update session date:", err));
              }
            }}
          />
        </label>
      </header>

      {initialClips.length === 0 && jobs.length === 0 && <FilmingGuidelines />}

      <SessionWarnings
        dateSpan={dateSpanWarning}
        handedness={handednessMismatch}
        playerBats={player.bats}
      />

      {/* Persisted clips (resume view: these survive tab closes). */}
      {errorClips.length > 1 && (
        <div className="mb-2 flex justify-end">
          <button
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={clearAllErrors}
          >
            Clear {errorClips.length} failed clips — then re-add the files to re-run
          </button>
        </div>
      )}
      {initialClips.length > 0 && (
        <ul className="mb-4 space-y-2">
          {initialClips.map((clip) => (
            <li
              key={clip.id}
              className="flex items-start gap-3 rounded-lg border border-border/70 bg-card px-3 py-2.5"
            >
              {clip.status === "ok" ? (
                <Check className="mt-0.5 size-4 shrink-0 text-green-600" />
              ) : clip.status === "rejected" ? (
                <X className="mt-0.5 size-4 shrink-0 text-red-500" />
              ) : (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {clip.fileName ?? "Clip"}
                  </span>
                  {clip.sourceFps !== null && (
                    <Badge variant="outline">{Math.round(clip.sourceFps)}fps</Badge>
                  )}
                  {clip.detectedBats && clip.detectedBats !== player.bats && (
                    <Badge variant="outline" className="text-amber-600">
                      swings {clip.detectedBats === "L" ? "lefty" : "righty"}?
                    </Badge>
                  )}
                </div>
                {clip.status === "rejected" && clip.rejectionReason && (
                  <p className="mt-0.5 text-xs text-red-500/90">{clip.rejectionReason}</p>
                )}
                {clip.status === "ok" && heightOutliers.has(clip.id) && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="size-3.5" />
                    This hitter looks a different size than the others — different
                    player?
                    <button
                      className="underline"
                      onClick={() =>
                        excludeClip(clip.id, "Excluded by coach — looked like a different player")
                          .then(() => router.refresh())
                          .catch((err) => console.error("Couldn't exclude clip:", err))
                      }
                    >
                      Exclude clip
                    </button>
                  </p>
                )}
                {clip.status === "extracting" && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Interrupted — re-add the same file to finish it, or remove it
                  </p>
                )}
              </div>
              {clip.status !== "ok" && (
                <button
                  className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-red-500"
                  title="Remove this clip — re-add the file to run it again"
                  onClick={() => removeClip(clip)}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* In-flight local jobs. */}
      {jobs.filter((j) => j.status.kind !== "done").length > 0 && (
        <ul className="mb-4 space-y-2">
          {jobs
            .filter((j) => j.status.kind !== "done")
            .map((job) => (
              <JobRow
                key={job.id}
                job={job}
                onRetryUpload={() => retryUpload(job)}
                onDismiss={() => dismissJob(job)}
              />
            ))}
        </ul>
      )}

      <AddClipsZone onFiles={addFiles} />

      <div className="mt-6 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {okClips.length} usable swing{okClips.length === 1 ? "" : "s"}
            {!ready && ` — need at least ${MIN_USABLE_CLIPS} to analyze`}
            {ready && okClips.length < 5 && " (more swings = a sharper read)"}
          </p>
          <Button onClick={startAnalyze} disabled={!ready || busy || analyzing}>
            {analyzing && <Loader2 data-icon="inline-start" className="animate-spin" />}
            Analyze
          </Button>
        </div>
        {analyzeError && <p className="text-sm text-red-500">{analyzeError}</p>}
        <button
          className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => {
            if (window.confirm("Delete this session and its extracted data?")) {
              deleteSession(session.id)
                .then(() => router.push(`/swing/players/${player.id}`))
                .catch((err) => {
                  console.error("Couldn't delete session:", err);
                  window.alert(
                    err instanceof Error ? err.message : "Couldn't delete session."
                  );
                });
            }
          }}
        >
          <Trash2 className="mr-1 inline size-3" />
          Delete session
        </button>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------ components - */

function JobRow({
  job,
  onRetryUpload,
  onDismiss,
}: {
  job: Job;
  onRetryUpload: () => void;
  onDismiss: () => void;
}) {
  const s = job.status;
  const dismissible = ["duplicate", "rejected", "upload_failed"].includes(s.kind);
  return (
    <li className="rounded-lg border border-border/70 bg-card px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Film className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{job.file.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {s.kind === "queued" && "Waiting…"}
          {s.kind === "fingerprinting" && "Checking…"}
          {s.kind === "uploading" && "Saving…"}
          {s.kind === "duplicate" && "Already added"}
          {s.kind === "extracting" && `${stageLabel(s.stage)} ${s.done}/${s.total}`}
        </span>
        {dismissible && (
          <button
            className="shrink-0 text-muted-foreground transition-colors hover:text-red-500"
            title="Dismiss"
            onClick={onDismiss}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {s.kind === "extracting" && (
        <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-sky-500 transition-[width]"
            style={{ width: `${Math.round((s.done / Math.max(s.total, 1)) * 100)}%` }}
          />
        </div>
      )}
      {s.kind === "rejected" && (
        <p className="mt-1 text-xs text-red-500/90">{s.message}</p>
      )}
      {s.kind === "upload_failed" && (
        <p className="mt-1 text-xs text-amber-600">
          {s.message}{" "}
          <button className="underline" onClick={onRetryUpload}>
            Retry upload
          </button>{" "}
          (won&apos;t re-process the video)
        </p>
      )}
      {job.warnings.map((w) => (
        <p key={w} className="mt-1 text-xs text-amber-600">
          {w}
        </p>
      ))}
    </li>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "decoding":
      return "Reading video";
    case "pose":
      return "Tracking body";
    case "annotating":
      return "Drawing evidence";
    default:
      return stage;
  }
}

function AddClipsZone({ onFiles }: { onFiles: (files: FileList | File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={`rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
        dragOver ? "border-sky-400 bg-sky-50/50" : "border-border"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mov,.mp4"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        <Plus data-icon="inline-start" />
        Add swing clips
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Clips are analyzed on this device — the video itself is never uploaded.
      </p>
    </div>
  );
}

function FilmingGuidelines() {
  return (
    <section className="mb-4 rounded-xl border border-sky-200/70 bg-sky-50/50 p-4 text-sm dark:border-sky-900 dark:bg-sky-950/30">
      <h2 className="mb-2 font-medium">How to film for a good read</h2>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>240fps slo-mo on the iPhone camera, phone held level</li>
        <li>
          Film from the <strong>side</strong>, facing the hitter&apos;s chest — not from
          the front or behind
        </li>
        <li>One swing per clip, whole body in frame the entire time</li>
        <li>Only the hitter in frame (no teammates walking through)</li>
        <li>
          <strong>AirDrop</strong> clips straight from Photos — slow-motion exports
          come through at 30fps and are handled automatically
        </li>
        <li>5–10 swings makes the best assessment</li>
      </ul>
    </section>
  );
}

function SessionWarnings({
  dateSpan,
  handedness,
  playerBats,
}: {
  dateSpan: boolean;
  handedness: boolean;
  playerBats: string;
}) {
  if (!dateSpan && !handedness) return null;
  return (
    <div className="mb-4 space-y-2">
      {dateSpan && (
        <Warning text="These clips were filmed on different days. One session should be one day of swings — split older clips into their own session for honest progress tracking." />
      )}
      {handedness && (
        <Warning
          text={`Some clips show a hitter swinging from the other side than ${playerBats === "L" ? "lefty" : "righty"} (this player's listed side). Wrong kid, or is the roster wrong?`}
        />
      )}
    </div>
  );
}

function Warning({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      {text}
    </p>
  );
}

function CenteredState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      {icon}
      <h1 className="font-serif text-xl">{title}</h1>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
      {action}
    </main>
  );
}
