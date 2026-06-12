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
  HIGH_SPEED_FPS_THRESHOLD,
  MAX_COARSE_SAMPLES,
  SLOW_MOTION_CAPTURE_RATES,
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
  peakHandSpeedMs,
} from "./phases";
import { denseGate, preGate, REJECTION_MESSAGES, type RejectionCode } from "./quality";
import {
  detectStillEncoding,
  renderStill,
  type RenderedStill,
} from "./annotate";
import { renderSwingVideo, type RenderedSwingVideo } from "./render-video";

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
      /** 1 for real-time clips; ~8 for a 240fps slo-mo baked into a 30fps
       * export (AirDrop). Timing metrics are already divided by this. */
      slowMotionFactor: number;
      /** Dense conditioned keypoint series — THE persisted artifact: a better
       * pose model later re-derives everything from this without re-filming. */
      keypoints: KeypointFrame[];
      stills: RenderedStill[];
      /** Annotated slow-motion swing video — present when this browser can
       * encode H.264; stills remain the guaranteed evidence either way. */
      video: RenderedSwingVideo | null;
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

  /* Pass 1 — coarse sweep to find the swing window. Long clips sample
   * sparser (capped pose calls), not slower. */
  const coarseFps = Math.min(
    COARSE_FPS,
    Math.max(5, MAX_COARSE_SAMPLES / Math.max(probe.durationSeconds, 1))
  );
  const coarseRaw = await runPass(
    sampleTimestamps(0, durationMs, coarseFps),
    "pose"
  );
  if (coarseRaw.length < 5) return rejected("low_pose_confidence", []);
  const coarse = conditionSeries(coarseRaw, coarseFps);

  /* Time-scale candidates: a low-fps clip is usually a slo-mo edit BAKED into
   * the export (AirDrop renders 240fps capture as a ~8x-stretched 30fps file).
   * All motion slows uniformly, so detection runs in real units by scaling
   * speeds; try real-time first, then the baked interpretations. */
  const trackFps = probe.trackFps ?? coarseFps;
  const scaleCandidates =
    trackFps >= HIGH_SPEED_FPS_THRESHOLD
      ? [1]
      : [
          1,
          ...SLOW_MOTION_CAPTURE_RATES.map((rate) => rate / trackFps).filter(
            (s) => s > 1.5
          ),
        ];
  /* Pick the scale by SCREENING, not first-burst-wins: pose jitter can spike
   * one frame over the speed threshold at the wrong scale, and locking onto
   * that noise burst makes the dense pass reject a perfectly good swing.
   * A candidate only wins outright when the coarse series supports a fully
   * plausible swing read at that scale; otherwise fall back to the first
   * scale that at least showed a burst and let the dense pass decide. */
  let timeScale = 0;
  let bursts: ReturnType<typeof findSwingBursts> = [];
  let fallbackScale = 0;
  let fallbackBursts: ReturnType<typeof findSwingBursts> = [];
  for (const candidate of scaleCandidates) {
    const candidateBursts = findSwingBursts(coarse, candidate);
    console.debug(
      `[swing] scale ${candidate}: ${candidateBursts.length} burst(s)` +
        (candidateBursts.length
          ? ` (top peak ${mostProminentBurst(candidateBursts)!.peakSpeed.toFixed(2)} h/s @ ${Math.round(mostProminentBurst(candidateBursts)!.peakMs)}ms)`
          : "")
    );
    if (candidateBursts.length === 0) continue;
    if (fallbackScale === 0) {
      fallbackScale = candidate;
      fallbackBursts = candidateBursts;
    }
    if (detectPhases(coarse, candidate) !== null) {
      timeScale = candidate;
      bursts = candidateBursts;
      break;
    }
  }
  if (timeScale === 0) {
    timeScale = fallbackScale || 1;
    bursts = fallbackBursts;
    console.debug(`[swing] no candidate passed coarse screening; falling back to scale ${timeScale}`);
  }
  const gate1 = preGate(coarse, bursts);
  if (!gate1.ok) return rejected(gate1.code!, gate1.warnings);
  const burst = mostProminentBurst(bursts)!;
  if (timeScale > 1) {
    gate1.warnings.push(
      `Slow-motion export detected (~${Math.round(timeScale)}x): timing estimated assuming ${Math.round(trackFps * timeScale)}fps capture.`
    );
  }

  /* Pass 2 — dense sampling around the chosen burst. Window and sampling are
   * defined in REAL time and mapped into clip time via timeScale: a baked
   * slo-mo clip carries its full capture-rate detail, just stretched.
   * Anchored on the burst's FIRST strong peak (the swing), not its absolute
   * peak (often post-swing junk). If the detected contact still lands at the
   * window's head — no stance/load lead-in — re-center once and retry. */
  const denseFps = Math.min(trackFps, Math.max(DENSE_FPS / timeScale, 5));
  const runDense = async (centerMs: number) => {
    const windowStart = Math.max(0, centerMs - DENSE_WINDOW_MS * timeScale * 1.5);
    const windowEnd = Math.min(durationMs, centerMs + DENSE_WINDOW_MS * timeScale);
    const raw = await runPass(sampleTimestamps(windowStart, windowEnd, denseFps), "pose");
    const dense = raw.length >= 10 ? conditionSeries(raw, denseFps) : null;
    console.debug(
      `[swing] dense pass: ${raw.length} frames @ ${denseFps.toFixed(1)} clip-fps, window ${Math.round(windowStart)}–${Math.round(windowEnd)}ms, scale ${timeScale}`
    );
    return { dense, windowStart };
  };

  let { dense, windowStart } = await runDense(burst.centerMs);
  if (!dense) return rejected("low_pose_confidence", gate1.warnings);
  let detection = detectPhases(dense, timeScale);

  const needsRecenter = (() => {
    if (!detection) return true;
    const leadInMs = (detection.events.contact ?? 0) - windowStart;
    return leadInMs < 400 * timeScale; // no room for stance/load before contact
  })();
  if (needsRecenter) {
    const recenter = detection?.events.contact ?? peakHandSpeedMs(dense);
    if (recenter !== null && Math.abs(recenter - burst.centerMs) > 100) {
      console.debug(`[swing] re-centering dense window on ${Math.round(recenter)}ms`);
      const second = await runDense(recenter);
      if (second.dense) {
        const secondDetection = detectPhases(second.dense, timeScale);
        if (secondDetection) {
          dense = second.dense;
          windowStart = second.windowStart;
          detection = secondDetection;
        }
      }
    }
  }
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

  /* Annotated swing video: same overlays, playable before/after context.
   * Best-effort — encoding support varies and the stills already satisfy R7. */
  const video = await renderSwingVideo(
    source,
    dense,
    detection,
    durationMs,
    trackFps,
    (done, total) => onProgress({ stage: "annotating", done, total })
  );

  return {
    ok: true,
    events: detection.events,
    metrics,
    detectedBats: detection.detectedBats,
    heightNorm: detection.heightNorm,
    slowMotionFactor: timeScale,
    keypoints: dense,
    stills,
    video,
    warnings: [...gate1.warnings, ...gate2.warnings],
    benchmark: benchmark(),
  };
}
