// The FrameSource seam: everything downstream of decode (pose → smoothing →
// phases → metrics → annotate) consumes a timestamped frame stream, never a
// file. v1 ships two sources — WebCodecs decode (worker-side, via Mediabunny)
// and a <video> seek-stepping fallback (DOM-bound, main thread) — and v2's
// live tee-station mode adds a camera source without touching the core.
//
// This module is plain TS with no Next.js or Supabase coupling, by design.

/** A single decoded frame. Always call close() promptly — decoded frames hold
 * GPU/decoder memory, and unclosed frames stall the WebCodecs pipeline. */
export interface SampledFrame {
  /** Clip-relative presentation time, milliseconds. */
  timestampMs: number;
  /** Drawable + pose-compatible image (VideoFrame or ImageBitmap). */
  image: VideoFrame | ImageBitmap;
  width: number;
  height: number;
  close(): void;
}

export interface FrameSource {
  /**
   * Yields one frame (or null when unavailable) per requested timestamp.
   * Timestamps must be monotonically increasing, in milliseconds.
   */
  framesAt(timestampsMs: number[]): AsyncGenerator<SampledFrame | null>;
  close(): void | Promise<void>;
}

export type DecodePath = "webcodecs" | "video-element" | "unsupported";

export interface ClipProbe {
  path: DecodePath;
  /** Human-readable reason when path is "unsupported". */
  reason?: string;
  /** Actual track frame rate from container metadata — NEVER assumed 240.
   * Some share paths bake the slo-mo edit into a ~30fps file. */
  trackFps: number | null;
  durationSeconds: number;
  width: number;
  height: number;
  codec: string | null;
}

/** True high-speed footage; below this we warn and reduce timing confidence. */
export const HIGH_SPEED_FPS_THRESHOLD = 100;

/** Coarse pass sampling rate (find the swing window cheaply). */
export const COARSE_FPS = 30;
/** Dense pass sampling cap around the detected swing window. */
export const DENSE_FPS = 120;
/** Dense window half-width around the detected wrist-speed burst, ms. */
export const DENSE_WINDOW_MS = 600;

/** Evenly spaced sample timestamps over [startMs, endMs] at the given rate,
 * clamped to the clip and offset to mid-frame to dodge seek rounding. */
export function sampleTimestamps(
  startMs: number,
  endMs: number,
  fps: number
): number[] {
  const stepMs = 1000 / fps;
  const out: number[] = [];
  for (let t = startMs + stepMs / 2; t < endMs; t += stepMs) out.push(t);
  return out;
}
