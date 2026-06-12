// Annotated swing video: a short H.264 MP4 covering the swing with the same
// overlays as the stills (skeleton, stance-head reference, posture line,
// stride markers, live phase chip) burned into every frame. Rendered
// CLIENT-SIDE AT EXTRACTION TIME by hard constraint — production can never
// render it later because raw video is gone.
//
// Encoded via WebCodecs (mediabunny Output): H.264 for universal playback —
// never HEVC. Output timestamps are scaled so every clip plays at roughly 8x
// slow motion regardless of how the source was exported (a baked slo-mo
// export is already stretched; true high-speed sources get slowed at encode).
//
// Failure here is never fatal: the stills are the guaranteed evidence; the
// video is an upgrade the caller skips when encoding isn't supported.

import type { SwingEvents, SwingPhase } from "@/lib/swing/types";
import { SWING_PHASES } from "@/lib/swing/types";
import {
  BufferTarget,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  VideoSample,
  VideoSampleSource,
  canEncode,
} from "mediabunny";
import { sampleTimestamps, type FrameSource } from "./frame-source";
import type { KeypointFrame } from "./pose";
import type { PhaseDetection } from "./phases";
import { nearestFrame } from "./smoothing";
import { drawOverlay } from "./annotate";

const MAX_VIDEO_HEIGHT = 720;
/** REAL-time window around contact: enough lead-in to see the load and
 * stride build, enough follow-through to see the finish. */
const PRE_CONTACT_MS = 1200;
const POST_CONTACT_MS = 600;
/** Target output frame rate (clip-time sampling is capped by the track). */
const OUTPUT_FPS = 24;
/** Perceived slow-motion factor every clip should play at. */
const TARGET_SLOWDOWN = 8;

export interface RenderedSwingVideo {
  blob: Blob;
  contentType: "video/mp4";
  /** Clip-time ms of the video's first frame — maps event times into the
   * video's timeline: videoSec = (eventMs - startMs) * slowdown / 1000. */
  startMs: number;
  /** Output-time stretch applied at encode (1 for already-slow baked exports). */
  slowdown: number;
}

export async function renderSwingVideo(
  source: FrameSource,
  keypoints: KeypointFrame[],
  detection: PhaseDetection,
  durationMs: number,
  trackFps: number,
  onProgress: (done: number, total: number) => void
): Promise<RenderedSwingVideo | null> {
  try {
    if (typeof VideoEncoder === "undefined" || !(await canEncode("avc"))) {
      return null;
    }
    const contactMs = detection.events.contact;
    if (contactMs === undefined) return null;
    const timeScale = detection.timeScale || 1;

    const startMs = Math.max(0, contactMs - PRE_CONTACT_MS * timeScale);
    const endMs = Math.min(durationMs, contactMs + POST_CONTACT_MS * timeScale);
    // The source is already timeScale-times slower than real time; stretch
    // the remainder at encode so everything lands near TARGET_SLOWDOWN.
    const slowdown = Math.max(1, Math.round(TARGET_SLOWDOWN / timeScale));
    const sampleFps = Math.min(trackFps, OUTPUT_FPS);
    const timestamps = sampleTimestamps(startMs, endMs, sampleFps);
    if (timestamps.length < 5) return null;

    const stanceFrame =
      nearestFrame(keypoints, detection.events.stance ?? startMs) ?? keypoints[0];

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    const videoSource = new VideoSampleSource({
      codec: "avc",
      bitrate: QUALITY_MEDIUM,
    });
    output.addVideoTrack(videoSource);
    await output.start();

    let canvas: OffscreenCanvas | null = null;
    let g: OffscreenCanvasRenderingContext2D | null = null;
    let done = 0;
    const frameDurationSec = (1 / sampleFps) * slowdown;

    for await (const sampled of source.framesAt(timestamps)) {
      done++;
      onProgress(done, timestamps.length);
      if (!sampled) continue;
      try {
        if (!canvas) {
          const scale = Math.min(1, MAX_VIDEO_HEIGHT / sampled.height);
          // H.264 wants even dimensions.
          const w = Math.round((sampled.width * scale) / 2) * 2;
          const h = Math.round((sampled.height * scale) / 2) * 2;
          canvas = new OffscreenCanvas(w, h);
          g = canvas.getContext("2d");
        }
        if (!g || !canvas) return null;
        g.drawImage(sampled.image, 0, 0, canvas.width, canvas.height);
        const kf = nearestFrame(keypoints, sampled.timestampMs);
        if (kf) {
          drawOverlay(
            g,
            kf,
            phaseAt(detection.events, sampled.timestampMs),
            stanceFrame,
            canvas.width,
            canvas.height
          );
        }
        const outSec = ((sampled.timestampMs - startMs) / 1000) * slowdown;
        const videoSample = new VideoSample(canvas, {
          timestamp: outSec,
          duration: frameDurationSec,
        });
        await videoSource.add(videoSample);
        videoSample.close();
      } finally {
        sampled.close();
      }
    }

    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer || buffer.byteLength === 0) return null;
    return {
      blob: new Blob([buffer], { type: "video/mp4" }),
      contentType: "video/mp4",
      startMs,
      slowdown,
    };
  } catch (error) {
    console.debug(
      `[swing] annotated video render skipped: ${error instanceof Error ? error.message : error}`
    );
    return null;
  }
}

/** The phase in effect at a clip-time instant (last event at or before it). */
function phaseAt(events: SwingEvents, timestampMs: number): SwingPhase | null {
  let current: SwingPhase | null = null;
  for (const phase of SWING_PHASES) {
    const t = events[phase];
    if (t !== undefined && t <= timestampMs + 1) current = phase;
  }
  return current;
}
