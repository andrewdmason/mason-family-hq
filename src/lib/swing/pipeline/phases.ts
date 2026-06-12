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
  /** Window anchor: the FIRST strong local peak in the burst. A swing's
   * aftermath (bat drop, the coach lowering the phone) often reads faster
   * than the swing itself and merges into the same burst — but it always
   * comes AFTER contact, so the first strong peak is the swing. */
  centerMs: number;
  startMs: number;
  endMs: number;
}

export interface PhaseDetection {
  events: SwingEvents;
  /** Hitter height in normalized units at stance (metric normalizer). */
  heightNorm: number;
  /** Clip-time-to-real-time factor: 1 for real-time clips, ~8 for an iPhone
   * 240fps slo-mo baked into a 30fps export. Event timestamps stay in CLIP
   * time (stills need them); durations divide by this for real ms. */
  timeScale: number;
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
export function findSwingBursts(
  frames: KeypointFrame[],
  timeScale = 1
): SwingWindow[] {
  if (frames.length < 5) return [];
  const height = medianHeight(frames);
  // timeScale converts clip-time speeds to real speeds: a baked slo-mo export
  // slows every motion uniformly, so thresholds stay in real units.
  const speeds = speedSeries(frames, handsMid, height).map((v) => v * timeScale);
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
  const merged = mergeCloseBursts(bursts, timeScale);
  for (const burst of merged) {
    burst.centerMs = firstStrongPeakMs(frames, speeds, burst);
  }
  return merged;
}

/** First local speed maximum ≥ 60% of the burst's peak, within the burst. */
function firstStrongPeakMs(
  frames: KeypointFrame[],
  speeds: number[],
  burst: SwingWindow
): number {
  const floor = burst.peakSpeed * 0.6;
  for (let i = 1; i < speeds.length - 1; i++) {
    const t = frames[i].timestampMs;
    if (t < burst.startMs || t > burst.endMs) continue;
    if (speeds[i] >= floor && speeds[i] >= speeds[i - 1] && speeds[i] >= speeds[i + 1]) {
      return t;
    }
  }
  return burst.peakMs;
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
    centerMs: frames[peakIdx].timestampMs,
    peakSpeed,
  });
}

function mergeCloseBursts(bursts: SwingWindow[], timeScale = 1): SwingWindow[] {
  const merged: SwingWindow[] = [];
  for (const b of bursts) {
    const prev = merged[merged.length - 1];
    // burstSeparationMs is a REAL-time quiet gap; clip time stretches by scale.
    if (prev && b.startMs - prev.endMs < PHASE_TUNING.burstSeparationMs * timeScale) {
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
 * Full event detection over the DENSE (conditioned) series.
 *
 * Real clips of real kids contain MANY fast-hand moments — bat waggles,
 * practice half-swings, the actual swing, the bat drop, the coach lowering
 * the phone — and the junk often reads FASTER than the swing. So detection
 * is hypothesis testing, not pick-the-global-peak: every strong local speed
 * maximum is a contact candidate (fastest first), and the first one that
 * supports a fully plausible swing read wins. Junk candidates fail the
 * plausibility band (their "swings" last a frame or two) and fall through.
 *
 * Returns null when no candidate yields a plausible read — the caller turns
 * that into a per-clip rejection, never garbage metrics.
 */
const MAX_CONTACT_CANDIDATES = 5;
/** Event scans stay within this REAL-time neighborhood before contact. */
const PRE_CONTACT_SCAN_MS = 3000;
const POST_CONTACT_SCAN_MS = 1500;
/** Real hand speed (heights/s) considered "quiet" when locating the stance. */
const QUIET_SPEED = 0.8;

export function detectPhases(
  frames: KeypointFrame[],
  timeScale = 1
): PhaseDetection | null {
  if (frames.length < 10) {
    console.debug(`[swing] detectPhases: too few frames (${frames.length})`);
    return null;
  }
  const heightNorm = medianHeight(frames);
  const speeds = speedSeries(frames, handsMid, heightNorm).map((v) => v * timeScale);

  const candidates = contactCandidates(frames, speeds, timeScale);
  if (candidates.length === 0) {
    console.debug(
      `[swing] detectPhases: no candidate above threshold (scale ${timeScale})`
    );
    return null;
  }
  for (const contactIdx of candidates) {
    const detection = detectAroundContact(
      frames,
      speeds,
      contactIdx,
      heightNorm,
      timeScale
    );
    if (detection) return detection;
  }
  console.debug(
    `[swing] detectPhases: ${candidates.length} candidate(s), none plausible (scale ${timeScale})`
  );
  return null;
}

/** Strong local speed maxima, fastest first, deduped within 300 real ms. */
function contactCandidates(
  frames: KeypointFrame[],
  speeds: number[],
  timeScale: number
): number[] {
  const maxima: number[] = [];
  for (let i = 1; i < speeds.length - 1; i++) {
    if (
      speeds[i] >= PHASE_TUNING.burstSpeedThreshold &&
      speeds[i] >= speeds[i - 1] &&
      speeds[i] >= speeds[i + 1]
    ) {
      maxima.push(i);
    }
  }
  maxima.sort((a, b) => speeds[b] - speeds[a]);
  const picked: number[] = [];
  for (const idx of maxima) {
    if (
      picked.some(
        (p) =>
          Math.abs(frames[p].timestampMs - frames[idx].timestampMs) <
          300 * timeScale
      )
    ) {
      continue;
    }
    picked.push(idx);
    if (picked.length >= MAX_CONTACT_CANDIDATES) break;
  }
  return picked;
}

function detectAroundContact(
  frames: KeypointFrame[],
  speeds: number[],
  contactIdx: number,
  heightNorm: number,
  timeScale: number
): PhaseDetection | null {
  const peakSpeed = speeds[contactIdx];
  const contactMs = frames[contactIdx].timestampMs;
  // Scans stay local to this candidate: a wide window holds other motion
  // episodes whose ankle lifts / hand moves must not bleed into this read.
  let scanStart = 0;
  while (
    scanStart < contactIdx &&
    frames[scanStart].timestampMs < contactMs - PRE_CONTACT_SCAN_MS * timeScale
  ) {
    scanStart++;
  }

  // Swing direction: net hand x-travel through the burst.
  const from = handsMid(frames[Math.max(0, contactIdx - 5)]);
  const to = handsMid(frames[Math.min(frames.length - 1, contactIdx + 3)]);
  const swingDirection: 1 | -1 = to.x - from.x >= 0 ? 1 : -1;

  // Handedness: the lead ankle is the one further along the swing direction
  // at the start of this candidate's neighborhood (pre-swing stance-ish).
  const first = frames[scanStart];
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
  let belowCount = 0;
  for (let i = contactIdx; i > scanStart; i--) {
    if (speeds[i] < launchThreshold) {
      belowCount++;
      if (belowCount >= 2) break; // sustained quiet — the swing started here
    } else {
      belowCount = 0;
      launchIdx = i;
    }
  }

  // Finish: first decay below finishSpeedFraction × peak after contact,
  // capped to this candidate's neighborhood.
  let finishIdx = contactIdx;
  for (let i = contactIdx + 1; i < speeds.length; i++) {
    finishIdx = i;
    if (speeds[i] < peakSpeed * PHASE_TUNING.finishSpeedFraction) break;
    if (
      frames[i].timestampMs >
      contactMs + POST_CONTACT_SCAN_MS * timeScale
    ) {
      break;
    }
  }

  // Stride: lead-ankle vertical excursion before launch (y grows downward,
  // so lift = y below baseline minus threshold).
  const ankleY = frames.map((f) => f.landmarks[side.leadAnkle].y);
  const baselineY = percentile(
    ankleY.slice(scanStart, Math.max(scanStart + 3, launchIdx)),
    0.9
  );
  let liftIdx = -1;
  let plantIdx = -1;
  for (let i = scanStart; i < launchIdx; i++) {
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
  for (let i = scanStart + 1; i < plantIdx; i++) {
    const dt = (frames[i].timestampMs - frames[i - 1].timestampMs) / 1000;
    if (dt <= 0) continue;
    const rearwardSpeed =
      ((-(handsX[i] - handsX[i - 1]) * swingDirection) / heightNorm / dt) * timeScale;
    if (rearwardSpeed > PHASE_TUNING.loadSpeedThreshold) {
      loadIdx = i;
      break;
    }
  }

  // Stance: the START of the quiet run leading into the swing — walk back
  // from the first detected motion through the quiet stretch until the tail
  // of a previous fast episode (or the scan floor). A slow, sub-threshold
  // load must not drag the stance reference up against the plant.
  const preMotionIdx = loadIdx !== -1 ? loadIdx : Math.min(plantIdx, launchIdx);
  let stanceIdx = scanStart;
  for (let i = preMotionIdx - 1; i >= scanStart; i--) {
    if (speeds[i] >= QUIET_SPEED) {
      stanceIdx = Math.min(i + 1, Math.max(preMotionIdx - 1, scanStart));
      break;
    }
  }

  const events: SwingEvents = {
    stance: frames[stanceIdx].timestampMs,
    plant: frames[plantIdx].timestampMs,
    launch: frames[launchIdx].timestampMs,
    contact: frames[contactIdx].timestampMs,
    finish: frames[finishIdx].timestampMs,
  };
  if (loadIdx !== -1) events.load = frames[loadIdx].timestampMs;

  if (!plausible(events, timeScale)) {
    console.debug(
      `[swing] candidate @${Math.round(contactMs)}ms (${peakSpeed.toFixed(1)} h/s): implausible — ` +
        `launch→contact ${(((events.contact ?? 0) - (events.launch ?? 0)) / timeScale).toFixed(0)}ms real`
    );
    return null;
  }
  console.debug(
    `[swing] candidate @${Math.round(contactMs)}ms (${peakSpeed.toFixed(1)} h/s): plausible swing, ` +
      `launch→contact ${(((events.contact ?? 0) - (events.launch ?? 0)) / timeScale).toFixed(0)}ms real`
  );

  return {
    events,
    heightNorm,
    timeScale,
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

/** Ordering + duration sanity; violations mean "couldn't read this swing".
 * timeScale maps the real-time plausibility band into clip time. */
export function plausible(events: SwingEvents, timeScale = 1): boolean {
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
  const launchToContact = (contact - launch) / timeScale;
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

/** Timestamp of peak hand speed — used to re-center a mis-anchored dense window. */
export function peakHandSpeedMs(frames: KeypointFrame[]): number | null {
  if (frames.length < 3) return null;
  const heightNorm = medianHeight(frames);
  const speeds = speedSeries(frames, handsMid, heightNorm);
  let best = 1;
  for (let i = 2; i < speeds.length; i++) {
    if (speeds[i] > speeds[best]) best = i;
  }
  return frames[best].timestampMs;
}
