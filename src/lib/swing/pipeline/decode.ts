// Decode layer: probe an uploaded clip (container metadata, codec support,
// actual track fps) and produce a FrameSource for it.
//
// Primary path: Mediabunny over WebCodecs — handles QuickTime .mov / HEVC
// demux, GOP/keyframe mechanics, and frame-pool backpressure. Runs fine inside
// a worker (no DOM). Fallback path: <video> seek-stepping with seeked + rVFC
// pairing — DOM-bound, so it can only be constructed on the main thread; the
// host transfers ImageBitmaps into the worker.
//
// Memory rules: never buffer the file into an ArrayBuffer (BlobSource reads
// by random access); close every frame promptly.

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import type { ClipProbe, FrameSource, SampledFrame } from "./frame-source";

interface OpenedClip {
  probe: ClipProbe;
  /** Present when probe.path === "webcodecs". */
  source?: FrameSource;
}

/**
 * Probe a clip and, when WebCodecs-decodable, open a Mediabunny frame source.
 * Never throws for unsupported input — that's a probe result, not an error.
 */
export async function openClip(file: Blob): Promise<OpenedClip> {
  let input: Input | null = null;
  try {
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    if (!(await input.canRead())) {
      return {
        probe: unsupported("This file isn't a video format the app can read."),
      };
    }
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      return { probe: unsupported("No video track found in this file.") };
    }

    const [codec, durationSeconds, width, height] = await Promise.all([
      track.getCodecParameterString(),
      input.computeDuration([track]),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
    ]);

    // Actual track rate from packet stats — the load-bearing fps check.
    const stats = await track.computePacketStats(120);
    const trackFps = stats.averagePacketRate > 0 ? stats.averagePacketRate : null;

    const base = { trackFps, durationSeconds, width, height, codec };

    const decodable =
      typeof VideoDecoder !== "undefined" && (await track.canDecode());
    if (!decodable) {
      // Keep the probe metadata: the caller may still run the main-thread
      // <video> fallback if the browser can at least *play* the codec.
      return { probe: { ...base, path: "video-element" } };
    }

    const opened = input;
    input = null; // ownership moves to the source
    return {
      probe: { ...base, path: "webcodecs" },
      // CanvasSink (not VideoSampleSink): it applies the container's rotation
      // metadata by default — portrait iPhone footage decodes sideways as raw
      // VideoFrames, which silently corrupts every angle/ratio metric.
      source: new MediabunnyFrameSource(opened, new CanvasSink(track, { poolSize: 3 })),
    };
  } catch (error) {
    return {
      probe: unsupported(
        `Couldn't read this video (${error instanceof Error ? error.message : "unknown error"}).`
      ),
    };
  } finally {
    // Only reached with ownership intact when we are not returning a source.
    input?.dispose();
  }
}

function unsupported(reason: string): ClipProbe {
  return {
    path: "unsupported",
    reason,
    trackFps: null,
    durationSeconds: 0,
    width: 0,
    height: 0,
    codec: null,
  };
}

class MediabunnyFrameSource implements FrameSource {
  constructor(
    private input: Input,
    private sink: CanvasSink
  ) {}

  async *framesAt(timestampsMs: number[]): AsyncGenerator<SampledFrame | null> {
    const seconds = timestampsMs.map((t) => t / 1000);
    // canvasesAtTimestamps decodes each packet at most once for sorted input —
    // exactly the sparse-then-dense access pattern of the two-pass pipeline.
    // Canvases come from a small ring-buffer pool; the pipeline consumes each
    // frame fully (pose + optional annotate) before pulling the next, so pool
    // reuse never clobbers an in-flight frame.
    for await (const wrapped of this.sink.canvasesAtTimestamps(seconds)) {
      if (!wrapped) {
        yield null;
        continue;
      }
      yield {
        timestampMs: wrapped.timestamp * 1000,
        image: wrapped.canvas,
        width: wrapped.canvas.width,
        height: wrapped.canvas.height,
        close: () => {
          // pooled canvas — nothing to release per frame
        },
      };
    }
  }

  close(): void {
    this.input.dispose();
  }
}

/**
 * Main-thread fallback: seek-step a <video> element and hand out ImageBitmaps
 * (transferable into the worker). Slow (~tens of ms per seek) but universal
 * wherever the codec is playable. Safari gotcha handled here: `seeked` can
 * fire before the new frame is paintable, so each step also awaits one
 * requestVideoFrameCallback and uses its mediaTime as the authoritative
 * presentation timestamp.
 */
export class VideoElementFrameSource implements FrameSource {
  private video: HTMLVideoElement;
  private url: string;
  private ready: Promise<void>;

  constructor(file: Blob) {
    if (typeof document === "undefined") {
      throw new Error("VideoElementFrameSource requires the main thread");
    }
    this.url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = this.url;
    this.video = video;
    this.ready = new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () =>
        reject(new Error("This browser can't play this video format."));
    });
  }

  async *framesAt(timestampsMs: number[]): AsyncGenerator<SampledFrame | null> {
    await this.ready;
    for (const tMs of timestampsMs) {
      const target = Math.min(tMs / 1000, Math.max(this.video.duration - 0.001, 0));
      const mediaTime = await this.seekTo(target);
      if (mediaTime === null) {
        yield null;
        continue;
      }
      const bitmap = await createImageBitmap(this.video);
      yield {
        timestampMs: mediaTime * 1000,
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    }
  }

  private seekTo(seconds: number): Promise<number | null> {
    return new Promise((resolve) => {
      const video = this.video;
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timeout = setTimeout(() => finish(video.currentTime), 2000);
      video.requestVideoFrameCallback((_now, metadata) => {
        clearTimeout(timeout);
        finish(metadata.mediaTime);
      });
      video.onseeked = () => {
        // rVFC delivers the authoritative frame; seeked alone isn't enough on
        // Safari. The timeout above covers the no-new-frame edge.
      };
      video.currentTime = seconds;
    });
  }

  close(): void {
    this.video.removeAttribute("src");
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}
