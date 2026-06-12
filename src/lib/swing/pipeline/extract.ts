// Per-clip extraction orchestration: two-pass pose sampling over a
// FrameSource, conditioning, phase detection, quality gates, metrics, and
// evidence stills. Pure of environment — runs identically inside the worker
// (WebCodecs path) and on the main thread (seek-step fallback path), which is
// also what the v2 live mode re-hosts over a camera FrameSource.

import type { Bats, SwingEvents, SwingMetrics } from "@/lib/swing/types";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  COARSE_FPS,
  DENSE_FPS,
  DENSE_WINDOW_MS,
  sampleTimestamps,
  type ClipProbe,
  type FrameSource,
} from "./frame-source";
import { detectFrame, type KeypointFrame } from "./pose";
import { conditionSeries, nearestFrame } from "./smoothing";
import {
  detectPhases,
  findSwingBursts,
  mostProminentBurst,
} from "./phases";
import { denseGate, preGate, REJECTION_MESSAGES, type RejectionCode } from "./quality";
import {
  detectStillEncoding,
  renderStill,
  type RenderedStill,
} from "./annotate";

export type ExtractionStage = "decoding" | "pose" | "annotating";

export interface ExtractionProgress {
  stage: ExtractionStage;
  done: number;
  total: number;
}

export interface ExtractionBenchmark {
  poseMsPerFrame: number;
  framesProcessed: number;
  decodePath: ClipProbe["path"];
}

export type ExtractionResult =
  | {
      ok: true;
      events: SwingEvents;
      metrics: SwingMetrics;
      detectedBats: Bats;
      /** Hitter pixel height (normalized) — the cross-clip same-hitter signal. */
      heightNorm: number;
      /** Dense conditioned keypoint series — THE persisted artifact: a better
       * pose model later re-derives everything from this without re-filming. */
      keypoints: KeypointFrame[];
      stills: RenderedStill[];
      warnings: string[];
      benchmark: ExtractionBenchmark;
    }
  | {
      ok: false;
      rejectionCode: RejectionCode;
      rejectionMessage: string;
      warnings: string[];
      benchmark: ExtractionBenchmark;
    };

export async function extractClip(
  source: FrameSource,
  landmarker: PoseLandmarker,
  probe: ClipProbe,
  onProgress: (p: ExtractionProgress) => void
): Promise<ExtractionResult> {
  const durationMs = probe.durationSeconds * 1000;
  let poseMs = 0;
  let framesProcessed = 0;
  // VIDEO-mode timestamps must increase monotonically ACROSS passes too.
  let detectionClock = 0;
  const tick = () => (detectionClock += 1000 / 30);

  const runPass = async (
    timestamps: number[],
    stage: ExtractionStage
  ): Promise<KeypointFrame[]> => {
    const frames: KeypointFrame[] = [];
    let done = 0;
    for await (const sampled of source.framesAt(timestamps)) {
      done++;
      onProgress({ stage, done, total: timestamps.length });
      if (!sampled) continue;
      const t0 = performance.now();
      const kf = detectFrame(landmarker, sampled.image, sampled.timestampMs, tick());
      poseMs += performance.now() - t0;
      framesProcessed++;
      sampled.close();
      // Duplicate-timestamp guard: the <video> fallback can resolve two
      // requested timestamps to the same decoded frame — a zero-dt pair
      // corrupts speed series downstream.
      if (kf && kf.timestampMs !== frames[frames.length - 1]?.timestampMs) {
        frames.push(kf);
      }
    }
    return frames;
  };

  const benchmark = (): ExtractionBenchmark => ({
    poseMsPerFrame: framesProcessed > 0 ? poseMs / framesProcessed : 0,
    framesProcessed,
    decodePath: probe.path,
  });

  const rejected = (
    code: RejectionCode,
    warnings: string[]
  ): ExtractionResult => ({
    ok: false,
    rejectionCode: code,
    rejectionMessage: REJECTION_MESSAGES[code],
    warnings,
    benchmark: benchmark(),
  });

  /* Pass 1 — coarse sweep to find the swing window. */
  const coarseRaw = await runPass(
    sampleTimestamps(0, durationMs, COARSE_FPS),
    "pose"
  );
  if (coarseRaw.length < 5) return rejected("low_pose_confidence", []);
  const coarse = conditionSeries(coarseRaw, COARSE_FPS);
  const bursts = findSwingBursts(coarse);
  const gate1 = preGate(coarse, bursts);
  if (!gate1.ok) return rejected(gate1.code!, gate1.warnings);
  const burst = mostProminentBurst(bursts)!;

  /* Pass 2 — dense sampling around the chosen burst. */
  const denseFps = Math.min(DENSE_FPS, probe.trackFps ?? COARSE_FPS);
  const windowStart = Math.max(0, burst.peakMs - DENSE_WINDOW_MS * 1.5);
  const windowEnd = Math.min(durationMs, burst.peakMs + DENSE_WINDOW_MS);
  const denseRaw = await runPass(
    sampleTimestamps(windowStart, windowEnd, denseFps),
    "pose"
  );
  if (denseRaw.length < 10) return rejected("low_pose_confidence", gate1.warnings);
  const dense = conditionSeries(denseRaw, denseFps);

  const detection = detectPhases(dense);
  if (!detection) return rejected("implausible_swing", gate1.warnings);
  const gate2 = denseGate(dense, detection.events.launch, detection.events.contact);
  if (!gate2.ok) return rejected(gate2.code!, [...gate1.warnings, ...gate2.warnings]);

  const metrics = (await import("./metrics")).computeMetrics(dense, detection);

  /* Evidence stills at each detected phase event. */
  const encoding = await detectStillEncoding();
  const stanceFrame = nearestFrame(dense, detection.events.stance!);
  const eventEntries = (
    Object.entries(detection.events) as [keyof SwingEvents, number][]
  )
    .filter(([, t]) => t !== undefined)
    .sort((a, b) => a[1] - b[1]);
  const stills: RenderedStill[] = [];
  let stillDone = 0;
  const stillTimestamps = eventEntries.map(([, t]) => t);
  let entryIdx = 0;
  for await (const sampled of source.framesAt(stillTimestamps)) {
    const [phase] = eventEntries[entryIdx++];
    stillDone++;
    onProgress({ stage: "annotating", done: stillDone, total: eventEntries.length });
    if (!sampled) continue;
    const frame = nearestFrame(dense, sampled.timestampMs);
    if (!frame) {
      sampled.close();
      continue;
    }
    try {
      stills.push(
        await renderStill(sampled.image, frame, phase, {
          detection,
          stanceFrame: stanceFrame ?? frame,
          metrics,
          encoding,
        })
      );
    } finally {
      sampled.close();
    }
  }

  return {
    ok: true,
    events: detection.events,
    metrics,
    detectedBats: detection.detectedBats,
    heightNorm: detection.heightNorm,
    keypoints: dense,
    stills,
    warnings: [...gate1.warnings, ...gate2.warnings],
    benchmark: benchmark(),
  };
}
