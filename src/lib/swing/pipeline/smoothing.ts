// Keypoint series conditioning: bridge low-visibility gaps by linear
// interpolation, then Savitzky-Golay smooth each landmark series. Fast-motion
// pose noise otherwise corrupts event detection (the swing-segmentation
// literature interpolates + smooths before finding kinematic extrema).
//
// Pure functions over KeypointFrame[] — fixture-testable via
// scripts/verify-swing-phases.mts.

import { type KeypointFrame, type Landmark } from "./pose";

/** Visibility below which a landmark sample is treated as missing. */
export const VISIBILITY_FLOOR = 0.5;

/**
 * Bridge gaps where a landmark dips below the visibility floor, by linear
 * interpolation between the nearest good neighbors. Frames whose gap was
 * bridged are flagged `interpolated` (annotation renders those dashed).
 * Gaps at the series edges are left as-is (no extrapolation).
 */
export function interpolateGaps(frames: KeypointFrame[]): KeypointFrame[] {
  if (frames.length === 0) return frames;
  const out = frames.map((f) => ({
    ...f,
    landmarks: f.landmarks.map((l) => ({ ...l })),
  }));
  const landmarkCount = out[0].landmarks.length;

  for (let li = 0; li < landmarkCount; li++) {
    let i = 0;
    while (i < out.length) {
      if (out[i].landmarks[li].visibility >= VISIBILITY_FLOOR) {
        i++;
        continue;
      }
      const gapStart = i;
      while (i < out.length && out[i].landmarks[li].visibility < VISIBILITY_FLOOR) i++;
      const gapEnd = i; // exclusive
      const before = gapStart - 1;
      const after = gapEnd;
      if (before < 0 || after >= out.length) continue; // edge gap — skip
      const a = out[before].landmarks[li];
      const b = out[after].landmarks[li];
      const t0 = out[before].timestampMs;
      const t1 = out[after].timestampMs;
      for (let j = gapStart; j < gapEnd; j++) {
        const t = t1 === t0 ? 0.5 : (out[j].timestampMs - t0) / (t1 - t0);
        const lm = out[j].landmarks[li];
        lm.x = a.x + (b.x - a.x) * t;
        lm.y = a.y + (b.y - a.y) * t;
        lm.z = a.z + (b.z - a.z) * t;
        lm.visibility = VISIBILITY_FLOOR; // bridged, not observed
        out[j].interpolated = true;
      }
    }
  }
  return out;
}

/**
 * Savitzky-Golay coefficients for a quadratic fit over an odd window —
 * smooths while preserving peaks better than a moving average (peak wrist
 * speed IS the contact signal, so preserving extrema matters).
 */
function savitzkyGolayKernel(window: number): number[] {
  const half = Math.floor(window / 2);
  // Quadratic SG smoothing weights: w_i ∝ (3m² - 7 - 20i²/4)-style closed
  // form; computed via least-squares normal equations for robustness.
  const xs = Array.from({ length: window }, (_, i) => i - half);
  const s0 = window;
  const s2 = xs.reduce((s, x) => s + x * x, 0);
  const s4 = xs.reduce((s, x) => s + x ** 4, 0);
  const denom = s0 * s4 - s2 * s2;
  return xs.map((x) => (s4 - s2 * x * x) / denom);
}

/** Window size by sampling rate: ≈ one eighth of a second, odd, ≥5. */
export function smoothingWindowForFps(fps: number): number {
  const w = Math.max(5, Math.round(fps / 8));
  return w % 2 === 0 ? w + 1 : w;
}

export function smoothSeries(values: number[], window: number): number[] {
  if (values.length < window) return [...values];
  const kernel = savitzkyGolayKernel(window);
  const half = Math.floor(window / 2);
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    if (i < half || i >= values.length - half) {
      out[i] = values[i];
      continue;
    }
    let acc = 0;
    for (let k = 0; k < window; k++) acc += kernel[k] * values[i - half + k];
    out[i] = acc;
  }
  return out;
}

/** Smooth every landmark's x/y series in place-shape (returns new frames). */
export function smoothFrames(
  frames: KeypointFrame[],
  window: number
): KeypointFrame[] {
  if (frames.length === 0) return frames;
  const landmarkCount = frames[0].landmarks.length;
  const out = frames.map((f) => ({
    ...f,
    landmarks: f.landmarks.map((l) => ({ ...l })),
  }));
  for (let li = 0; li < landmarkCount; li++) {
    const xs = smoothSeries(frames.map((f) => f.landmarks[li].x), window);
    const ys = smoothSeries(frames.map((f) => f.landmarks[li].y), window);
    for (let i = 0; i < out.length; i++) {
      out[i].landmarks[li].x = xs[i];
      out[i].landmarks[li].y = ys[i];
    }
  }
  return out;
}

/** Convenience: interpolate gaps then smooth, the standard conditioning. */
export function conditionSeries(
  frames: KeypointFrame[],
  fps: number
): KeypointFrame[] {
  return smoothFrames(interpolateGaps(frames), smoothingWindowForFps(fps));
}

/* ------------------------------------------------------------ helpers ---- */

export function midpoint(a: Landmark, b: Landmark): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Hitter pixel height in normalized units: nose to ankle midpoint. */
export function hitterHeight(frame: KeypointFrame): number {
  const nose = frame.landmarks[0];
  const ankles = midpoint(frame.landmarks[27], frame.landmarks[28]);
  return Math.abs(ankles.y - nose.y);
}

/**
 * Speed series (normalized units per second, scaled by hitter height so a
 * small kid far from the camera reads the same as a big kid close up).
 */
export function speedSeries(
  frames: KeypointFrame[],
  pick: (f: KeypointFrame) => { x: number; y: number },
  heightNorm: number
): number[] {
  const out = new Array<number>(frames.length).fill(0);
  for (let i = 1; i < frames.length; i++) {
    const dt = (frames[i].timestampMs - frames[i - 1].timestampMs) / 1000;
    if (dt <= 0) continue;
    const a = pick(frames[i - 1]);
    const b = pick(frames[i]);
    const dist = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(heightNorm, 1e-6);
    out[i] = dist / dt; // heights per second
  }
  return out;
}
