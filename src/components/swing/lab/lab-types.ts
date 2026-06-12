// Shared types for the /swing/lab diagnostics harness. Mirrors the extraction
// worker's message protocol (src/lib/swing/pipeline/extraction.worker.ts).
// Type-only imports from the pipeline keep mediapipe/mediabunny out of the
// page bundle — the worker chunk is the only place that code runs.

import type {
  ExtractionBenchmark,
  ExtractionStage,
} from "@/lib/swing/pipeline/extract";
import type { ClipProbe } from "@/lib/swing/pipeline/frame-source";
import type { KeypointFrame, PoseDelegate } from "@/lib/swing/pipeline/pose";
import type { RejectionCode } from "@/lib/swing/pipeline/quality";
import type { Bats, SwingEvents, SwingMetrics } from "@/lib/swing/types";

/** Still as transferred from the worker (bytes, not Blob). */
export interface StillPayload {
  phase: string;
  contentType: string;
  annotations: string[];
  bytes: ArrayBuffer;
}

export interface OkResult {
  ok: true;
  events: SwingEvents;
  metrics: SwingMetrics;
  detectedBats: Bats;
  keypoints: KeypointFrame[];
  warnings: string[];
  benchmark: ExtractionBenchmark;
  /** Delegate that actually initialized (GPU init failures fall back to CPU). */
  delegate: PoseDelegate;
  stills: StillPayload[];
}

export interface RejectedResult {
  ok: false;
  rejectionCode: RejectionCode;
  rejectionMessage: string;
  warnings: string[];
  benchmark: ExtractionBenchmark;
  delegate: PoseDelegate;
}

/** Probe said the worker can't decode this clip (host-side fallback needed). */
export interface NeedsFallbackResult {
  ok: false;
  needsFallback: true;
}

export type WorkerResult = OkResult | RejectedResult | NeedsFallbackResult;

export type WorkerMessage =
  | { type: "probe"; jobId: string; probe: ClipProbe }
  | {
      type: "progress";
      jobId: string;
      stage: ExtractionStage;
      done: number;
      total: number;
    }
  | ({ type: "result"; jobId: string } & WorkerResult)
  | { type: "error"; jobId: string; message: string };

export function isNeedsFallback(r: WorkerResult): r is NeedsFallbackResult {
  return !r.ok && "needsFallback" in r;
}

export function isRejected(r: WorkerResult): r is RejectedResult {
  return !r.ok && "rejectionCode" in r;
}

// MediaPipe pose landmark indices used by the lab readouts. Kept as local
// constants (matching LM in src/lib/swing/pipeline/pose.ts) so the lab's
// client bundle never runtime-imports the pipeline modules.
export const LAB_LM = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/** Matches QUALITY_TUNING.minWristVisibility in pipeline/quality.ts. */
export const WRIST_VISIBILITY_THRESHOLD = 0.45;

export interface WristTrackability {
  /** Fraction of launch→contact frames where max(L,R wrist vis) ≥ threshold. */
  trackableFraction: number;
  minVisibility: number;
  meanVisibility: number;
  frameCount: number;
}

/**
 * The U1 spike gate readout: wrist trackability through the launch→contact
 * window — per-frame best-wrist visibility against the 0.45 threshold.
 */
export function computeWristTrackability(
  keypoints: KeypointFrame[],
  events: SwingEvents
): WristTrackability | null {
  const { launch, contact } = events;
  if (launch === undefined || contact === undefined) return null;
  const window = keypoints.filter(
    (f) => f.timestampMs >= launch && f.timestampMs <= contact
  );
  if (window.length === 0) return null;
  const best = window.map((f) =>
    Math.max(
      f.landmarks[LAB_LM.leftWrist]?.visibility ?? 0,
      f.landmarks[LAB_LM.rightWrist]?.visibility ?? 0
    )
  );
  return {
    trackableFraction:
      best.filter((v) => v >= WRIST_VISIBILITY_THRESHOLD).length / best.length,
    minVisibility: Math.min(...best),
    meanVisibility: best.reduce((s, v) => s + v, 0) / best.length,
    frameCount: window.length,
  };
}
