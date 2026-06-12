"use client";

// Extraction Lab shell: drop a local clip → run the extraction worker →
// inspect probe/benchmark/events/metrics/stills/keypoints. Nothing leaves the
// browser — no upload, no persistence. This is the U1 spike harness and it
// stays in the app as a diagnostics page.

import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, FlaskConical, Loader2, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExtractionStage } from "@/lib/swing/pipeline/extract";
import type { ClipProbe } from "@/lib/swing/pipeline/frame-source";
import type { PoseDelegate, PoseModel } from "@/lib/swing/pipeline/pose";
import {
  isNeedsFallback,
  isRejected,
  type WorkerMessage,
  type WorkerResult,
} from "./lab-types";
import {
  BenchmarkPanel,
  OkResultPanels,
  ProbePanel,
  RejectedPanel,
  WarningsList,
} from "./result-panels";

type RunStatus = "idle" | "running" | "done" | "failed";

interface Progress {
  stage: ExtractionStage;
  done: number;
  total: number;
}

const STAGE_LABELS: Record<ExtractionStage, string> = {
  decoding: "Decoding",
  pose: "Pose detection",
  annotating: "Rendering stills",
};

export function LabShell() {
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState<PoseModel>("heavy");
  const [delegate, setDelegate] = useState<PoseDelegate>("GPU");

  const [status, setStatus] = useState<RunStatus>("idle");
  const [probe, setProbe] = useState<ClipProbe | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<WorkerResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [wallTimeMs, setWallTimeMs] = useState<number | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    jobIdRef.current = null;
  }, []);

  useEffect(() => stopWorker, [stopWorker]);

  function resetRun() {
    setProbe(null);
    setProgress(null);
    setResult(null);
    setErrorMessage(null);
    setWallTimeMs(null);
  }

  function pickFile(picked: File | null) {
    if (!picked) return;
    stopWorker();
    resetRun();
    setStatus("idle");
    setFile(picked);
  }

  function run() {
    if (!file || status === "running") return;
    stopWorker();
    resetRun();
    setStatus("running");

    // Relative URL on purpose: Turbopack (Next 16.2) doesn't resolve the `@/`
    // alias inside `new URL(..., import.meta.url)` worker references.
    const worker = new Worker(
      new URL("../../../lib/swing/pipeline/extraction.worker.ts", import.meta.url)
    );
    const jobId = crypto.randomUUID();
    workerRef.current = worker;
    jobIdRef.current = jobId;
    startedAtRef.current = performance.now();

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;
      if (msg.jobId !== jobIdRef.current) return;
      switch (msg.type) {
        case "probe":
          setProbe(msg.probe);
          break;
        case "progress":
          setProgress({ stage: msg.stage, done: msg.done, total: msg.total });
          break;
        case "result":
          setWallTimeMs(
            startedAtRef.current !== null
              ? performance.now() - startedAtRef.current
              : null
          );
          setResult(msg);
          setStatus("done");
          stopWorker();
          break;
        case "error":
          setErrorMessage(msg.message);
          setStatus("failed");
          stopWorker();
          break;
      }
    };
    worker.onerror = () => {
      setErrorMessage(
        "The extraction worker crashed before reporting a result."
      );
      setStatus("failed");
      stopWorker();
    };

    worker.postMessage({ type: "extract", jobId, file, model, delegate });
  }

  const running = status === "running";

  return (
    <div className="mt-6 space-y-4">
      {/* ── Input: local clip, never uploaded ─────────────────────────── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files?.[0] ?? null);
        }}
        className={`flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-8 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Clapperboard className="size-6" />
        </span>
        {file ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="max-w-60 truncate font-medium sm:max-w-md">
              {file.name}
            </span>
            <span className="text-muted-foreground">
              {(file.size / (1024 * 1024)).toFixed(1)} MB
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear clip"
              disabled={running}
              onClick={() => {
                stopWorker();
                resetRun();
                setStatus("idle");
                setFile(null);
              }}
            >
              <X />
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Drop a swing clip here, or
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={running}
          onClick={() => fileInputRef.current?.click()}
        >
          {file ? "Choose a different clip" : "Choose a clip"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mov"
          className="hidden"
          onChange={(e) => {
            pickFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <p className="text-xs text-muted-foreground">
          Everything runs locally in this tab — the clip is never uploaded and
          nothing is persisted.
        </p>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="lab-model">Model</Label>
          <Select
            value={model}
            onValueChange={(v) => setModel(v as PoseModel)}
            disabled={running}
          >
            <SelectTrigger id="lab-model" size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="heavy">heavy</SelectItem>
              <SelectItem value="full">full</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lab-delegate">Delegate</Label>
          <Select
            value={delegate}
            onValueChange={(v) => setDelegate(v as PoseDelegate)}
            disabled={running}
          >
            <SelectTrigger id="lab-delegate" size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GPU">GPU</SelectItem>
              <SelectItem value="CPU">CPU</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={run} disabled={!file || running}>
          {running ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Play data-icon="inline-start" />
          )}
          {running ? "Extracting…" : "Run extraction"}
        </Button>
      </div>

      {/* ── Live progress ──────────────────────────────────────────────── */}
      {running && (
        <div className="space-y-1.5 rounded-xl border px-4 py-3">
          <p className="flex items-center gap-2 text-sm">
            <FlaskConical className="size-4 text-muted-foreground" />
            {progress
              ? `${STAGE_LABELS[progress.stage]} — ${progress.done}/${progress.total}`
              : "Probing clip and loading the pose model…"}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{
                width: progress
                  ? `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`
                  : "4%",
              }}
            />
          </div>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────── */}
      {probe && <ProbePanel probe={probe} />}

      {status === "failed" && (
        <FallbackNotice
          message={
            errorMessage ??
            "The extraction worker failed without a specific error."
          }
        />
      )}

      {result && isNeedsFallback(result) && (
        <FallbackNotice
          message={
            probe?.path === "video-element"
              ? "This browser can't decode the clip with WebCodecs. It needs the <video> seek-step fallback path, which isn't wired into the lab yet — try Chrome on a Mac for now."
              : (probe?.reason ??
                "This browser can't decode the clip at all — no WebCodecs support and no playable codec.")
          }
        />
      )}

      {result && !isNeedsFallback(result) && (
        <BenchmarkPanel
          benchmark={result.benchmark}
          delegate={result.delegate}
          wallTimeMs={wallTimeMs}
        />
      )}

      {result && isRejected(result) && (
        <>
          <RejectedPanel result={result} />
          <WarningsList warnings={result.warnings} />
        </>
      )}

      {result && result.ok && (
        <OkResultPanels
          result={result}
          probe={probe}
          clipName={file?.name ?? "clip"}
        />
      )}
    </div>
  );
}

function FallbackNotice({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
      <p className="font-medium text-destructive">Can&apos;t extract here</p>
      <p className="mt-0.5 text-muted-foreground">{message}</p>
    </div>
  );
}
