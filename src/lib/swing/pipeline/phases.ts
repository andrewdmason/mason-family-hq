// Swing phase detection from a conditioned keypoint series: kinematic-extrema
// heuristics (wrist-speed burst → contact at peak; lead-ankle lift/plant for
// the stride; rearward hand motion for the load), with plausibility checks so
// implausible series get rejected instead of producing garbage events.
//
// Every threshold lives in PHASE_TUNING — the U1 spike calibrates these
// against real clips of real kids. Pure functions, fixture-tested via
// scripts/verify-swing-phases.mts.

import type { Bats, SwingEvents } from "@/lib/swing/types";
import { LM, type KeypointFrame } from "./pose";
import { hitterHeight, midpoint, speedSeries } from "./smoothing";

export const PHASE_TUNING = {
  /** Wrist speed (hitter-heights/sec) above which a burst candidate starts. */
  burstSpeedThreshold: 3.0,
  /** Quiet gap separating distinct bursts (multi-swing clips), ms. */
  burstSeparationMs: 1500,
  /** Launch = last crossing above this fraction of peak speed before contact. */
  launchSpeedFraction: 0.25,
  /** Finish = first decay below this fraction of peak speed after contact. */
  finishSpeedFraction: 0.2,
  /** Lead-ankle lift: rise above stance baseline, in hitter-heights. */
  ankleLiftThreshold: 0.04,
  /** Lead-ankle plant: return within this of baseline, in hitter-heights. */
  anklePlantThreshold: 0.02,
  /** Hand rearward-motion speed marking load onset, heights/sec. */
  loadSpeedThreshold: 0.35,
  /** Plausible launch→contact duration band, ms (youth swings are slower). */
  minLaunchToContactMs: 40,
  maxLaunchToContactMs: 450,
  /** Segment x-width change rate (heights/sec) marking rotation onset. */
  rotationOnsetRateThreshold: 0.5,
} as const;

export interface SwingWindow {
  /** Burst peak time, ms. */
  peakMs: number;
  peakSpeed: number;
  startMs: number;
  endMs: number;
}

export interface PhaseDetection {
  events: SwingEvents;
  /** Hitter height in normalized units at stance (metric normalizer). */
  heightNorm: number;
  detectedBats: Bats;
  /** Sign of horizontal swing direction in image space (+x or -x). */
  swingDirection: 1 | -1;
  /** Lead-side landmark indices, resolved from handedness. */
  leadAnkle: number;
  leadWrist: number;
  leadShoulder: number;
  leadKnee: number;
  rearShoulder: number;
  rearElbow: number;
  rearHip: number;
  rearHeel: number;
}

function handsMid(f: KeypointFrame) {
  return midpoint(f.landmarks[LM.leftWrist], f.landmarks[LM.rightWrist]);
}

/**
 * Find wrist-speed bursts in a (coarse) series. Multiple bursts = multiple
 * swings in one clip; the caller uses the most prominent and flags the rest.
 */
export function findSwingBursts(frames: KeypointFrame[]): SwingWindow[] {
  if (frames.length < 5) return [];
  const height = medianHeight(frames);
  const speeds = speedSeries(frames, handsMid, height);
  const bursts: SwingWindow[] = [];
  let inBurst = false;
  let start = 0;
  let peak = 0;
  let peakIdx = 0;
  for (let i = 0; i < speeds.length; i++) {
    if (speeds[i] >= PHASE_TUNING.burstSpeedThreshold) {
      if (!inBurst) {
        inBurst = true;
        start = i;
        peak = 0;
      }
      if (speeds[i] > peak) {
        peak = speeds[i];
        peakIdx = i;
      }
    } else if (inBurst) {
      inBurst = false;
      pushBurst(bursts, frames, start, i - 1, peakIdx, peak);
    }
  }
  if (inBurst) pushBurst(bursts, frames, start, speeds.length - 1, peakIdx, peak);
  return mergeCloseBursts(bursts);
}

function pushBurst(
  bursts: SwingWindow[],
  frames: KeypointFrame[],
  startIdx: number,
  endIdx: number,
  peakIdx: number,
  peakSpeed: number
) {
  bursts.push({
    startMs: frames[startIdx].timestampMs,
    endMs: frames[endIdx].timestampMs,
    peakMs: frames[peakIdx].timestampMs,
    peakSpeed,
  });
}

function mergeCloseBursts(bursts: SwingWindow[]): SwingWindow[] {
  const merged: SwingWindow[] = [];
  for (const b of bursts) {
    const prev = merged[merged.length - 1];
    if (prev && b.startMs - prev.endMs < PHASE_TUNING.burstSeparationMs) {
      prev.endMs = b.endMs;
      if (b.peakSpeed > prev.peakSpeed) {
        prev.peakSpeed = b.peakSpeed;
        prev.peakMs = b.peakMs;
      }
    } else {
      merged.push({ ...b });
    }
  }
  return merged;
}

export function mostProminentBurst(bursts: SwingWindow[]): SwingWindow | null {
  return bursts.reduce<SwingWindow | null>(
    (best, b) => (best === null || b.peakSpeed > best.peakSpeed ? b : best),
    null
  );
}

function medianHeight(frames: KeypointFrame[]): number {
  const hs = frames.map(hitterHeight).sort((a, b) => a - b);
  return hs[Math.floor(hs.length / 2)] || 1e-6;
}

/**
 * Full event detection over the DENSE (conditioned) series around one burst.
 * Returns null when the series can't support a plausible swing read —
 * the caller turns that into a per-clip rejection, never garbage metrics.
 */
export function detectPhases(frames: KeypointFrame[]): PhaseDetection | null {
  if (frames.length < 10) return null;
  const heightNorm = medianHeight(frames);
  const speeds = speedSeries(frames, handsMid, heightNorm);

  // Contact = peak hand speed.
  let contactIdx = 0;
  for (let i = 1; i < speeds.length; i++) {
    if (speeds[i] > speeds[contactIdx]) contactIdx = i;
  }
  const peakSpeed = speeds[contactIdx];
  if (peakSpeed < PHASE_TUNING.burstSpeedThreshold) return null; // no swing here

  // Swing direction: net hand x-travel through the burst.
  const from = handsMid(frames[Math.max(0, contactIdx - 5)]);
  const to = handsMid(frames[Math.min(frames.length - 1, contactIdx + 3)]);
  const swingDirection: 1 | -1 = to.x - from.x >= 0 ? 1 : -1;

  // Handedness: the lead ankle is the one further along the swing direction
  // at the start of the series; a left lead leg means a right-handed batter.
  const first = frames[0];
  const leftLead =
    (first.landmarks[LM.leftAnkle].x - first.landmarks[LM.rightAnkle].x) *
      swingDirection >
    0;
  const detectedBats: Bats = leftLead ? "R" : "L";
  const side = leadRearIndices(leftLead);

  // Launch: last upward crossing of launchSpeedFraction × peak before contact.
  const launchThreshold = Math.max(
    peakSpeed * PHASE_TUNING.launchSpeedFraction,
    PHASE_TUNING.burstSpeedThreshold * 0.5
  );
  let launchIdx = contactIdx;
  for (let i = contactIdx; i > 0; i--) {
    if (speeds[i] < launchThreshold) break;
    launchIdx = i;
  }

  // Finish: first decay below finishSpeedFraction × peak after contact.
  let finishIdx = frames.length - 1;
  for (let i = contactIdx + 1; i < speeds.length; i++) {
    if (speeds[i] < peakSpeed * PHASE_TUNING.finishSpeedFraction) {
      finishIdx = i;
      break;
    }
  }

  // Stride: lead-ankle vertical excursion before launch (y grows downward,
  // so lift = y below baseline minus threshold).
  const ankleY = frames.map((f) => f.landmarks[side.leadAnkle].y);
  const baselineY = percentile(ankleY.slice(0, Math.max(3, launchIdx)), 0.9);
  let liftIdx = -1;
  let plantIdx = -1;
  for (let i = 0; i < launchIdx; i++) {
    if (
      liftIdx === -1 &&
      baselineY - ankleY[i] > PHASE_TUNING.ankleLiftThreshold * heightNorm
    ) {
      liftIdx = i;
    }
    if (
      liftIdx !== -1 &&
      baselineY - ankleY[i] < PHASE_TUNING.anklePlantThreshold * heightNorm
    ) {
      plantIdx = i;
      // keep scanning: the LAST settle before launch is the true plant
    }
  }
  // No-stride swings are legal (and a drill prescription): plant ≈ launch.
  if (plantIdx === -1) plantIdx = liftIdx !== -1 ? launchIdx : Math.max(launchIdx - 1, 0);

  // Load: onset of rearward hand travel before the stride completes.
  let loadIdx = -1;
  const handsX = frames.map((f) => handsMid(f).x);
  for (let i = 1; i < plantIdx; i++) {
    const dt = (frames[i].timestampMs - frames[i - 1].timestampMs) / 1000;
    if (dt <= 0) continue;
    const rearwardSpeed =
      (-(handsX[i] - handsX[i - 1]) * swingDirection) / heightNorm / dt;
    if (rearwardSpeed > PHASE_TUNING.loadSpeedThreshold) {
      loadIdx = i;
      break;
    }
  }

  // Stance: start of the series (coarse pass anchored the window pre-swing).
  const stanceIdx = 0;

  const events: SwingEvents = {
    stance: frames[stanceIdx].timestampMs,
    plant: frames[plantIdx].timestampMs,
    launch: frames[launchIdx].timestampMs,
    contact: frames[contactIdx].timestampMs,
    finish: frames[finishIdx].timestampMs,
  };
  if (loadIdx !== -1) events.load = frames[loadIdx].timestampMs;

  if (!plausible(events)) return null;

  return {
    events,
    heightNorm,
    detectedBats,
    swingDirection,
    ...side,
  };
}

function leadRearIndices(leftLead: boolean) {
  return leftLead
    ? {
        leadAnkle: LM.leftAnkle,
        leadWrist: LM.leftWrist,
        leadShoulder: LM.leftShoulder,
        leadKnee: LM.leftKnee,
        rearShoulder: LM.rightShoulder,
        rearElbow: LM.rightElbow,
        rearHip: LM.rightHip,
        rearHeel: LM.rightHeel,
      }
    : {
        leadAnkle: LM.rightAnkle,
        leadWrist: LM.rightWrist,
        leadShoulder: LM.rightShoulder,
        leadKnee: LM.rightKnee,
        rearShoulder: LM.leftShoulder,
        rearElbow: LM.leftElbow,
        rearHip: LM.leftHip,
        rearHeel: LM.leftHeel,
      };
}

/** Ordering + duration sanity; violations mean "couldn't read this swing". */
export function plausible(events: SwingEvents): boolean {
  const { stance, load, plant, launch, contact, finish } = events;
  if (
    stance === undefined ||
    plant === undefined ||
    launch === undefined ||
    contact === undefined ||
    finish === undefined
  ) {
    return false;
  }
  const ordered =
    stance <= (load ?? stance) &&
    (load ?? stance) <= plant + 1 &&
    plant <= launch + 1 &&
    launch <= contact &&
    contact <= finish;
  if (!ordered) return false;
  const launchToContact = contact - launch;
  return (
    launchToContact >= PHASE_TUNING.minLaunchToContactMs &&
    launchToContact <= PHASE_TUNING.maxLaunchToContactMs
  );
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
