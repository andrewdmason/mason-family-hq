// Annotated evidence stills: skeleton + metric reference lines drawn over a
// phase keyframe on an OffscreenCanvas, exported as WebP (JPEG on Safari —
// no WebP canvas encoder there; convertToBlob silently falls back to PNG,
// which the bucket allowlist deliberately rejects, so we detect and choose).
//
// Rendering happens CLIENT-SIDE AT EXTRACTION TIME by hard constraint:
// production can never render stills later because raw video is gone (AE4).
//
// Keeps a seam for the deferred overlay-clip follow-up: frame + overlay spec
// in, encoded artifact out.

import type { StillInfo, SwingMetrics, SwingPhase } from "@/lib/swing/types";
import { LM, type KeypointFrame } from "./pose";
import type { PhaseDetection } from "./phases";
import { BONES } from "./skeleton";

const MAX_STILL_HEIGHT = 720;

export interface StillEncoding {
  contentType: "image/webp" | "image/jpeg";
  quality: number;
}

/** Detect what this browser can actually encode (Safari: JPEG fallback). */
export async function detectStillEncoding(): Promise<StillEncoding> {
  try {
    const probe = new OffscreenCanvas(2, 2);
    probe.getContext("2d");
    const blob = await probe.convertToBlob({ type: "image/webp", quality: 0.8 });
    if (blob.type === "image/webp") {
      return { contentType: "image/webp", quality: 0.8 };
    }
  } catch {
    // fall through to JPEG
  }
  return { contentType: "image/jpeg", quality: 0.85 };
}

export interface RenderedStill {
  phase: SwingPhase;
  blob: Blob;
  contentType: string;
  annotations: string[];
}

export interface AnnotationContext {
  detection: PhaseDetection;
  /** Stance frame — reference lines (head box, posture line) carry from here. */
  stanceFrame: KeypointFrame;
  metrics: SwingMetrics;
  encoding: StillEncoding;
}

/**
 * Render one phase keyframe: source image, skeleton, phase label, and the
 * metric-specific reference lines that make the tells visible.
 */
export async function renderStill(
  image: VideoFrame | ImageBitmap | HTMLCanvasElement | OffscreenCanvas,
  frame: KeypointFrame,
  phase: SwingPhase,
  ctx: AnnotationContext
): Promise<RenderedStill> {
  const srcWidth = "displayWidth" in image ? image.displayWidth : image.width;
  const srcHeight = "displayHeight" in image ? image.displayHeight : image.height;
  const scale = Math.min(1, MAX_STILL_HEIGHT / srcHeight);
  const width = Math.round(srcWidth * scale);
  const height = Math.round(srcHeight * scale);

  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext("2d");
  if (!g) throw new Error("OffscreenCanvas 2d context unavailable");
  g.drawImage(image, 0, 0, width, height);

  const annotations: string[] = [];
  const px = (nx: number) => nx * width;
  const py = (ny: number) => ny * height;

  // Skeleton — dashed when this frame's landmarks were interpolated, so the
  // still never asserts precision the pose data doesn't have.
  g.lineWidth = Math.max(2, width / 320);
  g.strokeStyle = "rgba(56, 189, 248, 0.9)";
  g.setLineDash(frame.interpolated ? [6, 5] : []);
  for (const [a, b] of BONES) {
    const la = frame.landmarks[a];
    const lb = frame.landmarks[b];
    if (!la || !lb) continue;
    g.beginPath();
    g.moveTo(px(la.x), py(la.y));
    g.lineTo(px(lb.x), py(lb.y));
    g.stroke();
  }
  g.setLineDash([]);
  g.fillStyle = "rgba(56, 189, 248, 0.95)";
  for (const [a, b] of BONES) {
    for (const i of [a, b]) {
      const l = frame.landmarks[i];
      g.beginPath();
      g.arc(px(l.x), py(l.y), Math.max(2.5, width / 280), 0, Math.PI * 2);
      g.fill();
    }
  }

  // Head reference: the stance head position carried onto every later phase —
  // the "did his head move?" tell made visible.
  const stanceNose = ctx.stanceFrame.landmarks[LM.nose];
  drawCrosshair(g, px(stanceNose.x), py(stanceNose.y), width, "rgba(250, 204, 21, 0.95)");
  if (phase !== "stance") {
    const nose = frame.landmarks[LM.nose];
    g.strokeStyle = "rgba(250, 204, 21, 0.8)";
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(px(stanceNose.x), py(stanceNose.y));
    g.lineTo(px(nose.x), py(nose.y));
    g.stroke();
    g.setLineDash([]);
    annotations.push("head_drift");
  }

  // Posture line: hip-mid → shoulder-mid.
  const hips = mid(frame, LM.leftHip, LM.rightHip);
  const shoulders = mid(frame, LM.leftShoulder, LM.rightShoulder);
  g.strokeStyle = "rgba(74, 222, 128, 0.9)";
  g.lineWidth = Math.max(2, width / 360);
  g.beginPath();
  g.moveTo(px(hips.x), py(hips.y));
  g.lineTo(px(shoulders.x), py(shoulders.y));
  g.stroke();
  annotations.push("posture_line");

  // Stride markers at plant/launch/contact: vertical ticks at both ankles.
  if (phase === "plant" || phase === "launch" || phase === "contact") {
    g.strokeStyle = "rgba(248, 113, 113, 0.9)";
    for (const ankle of [LM.leftAnkle, LM.rightAnkle]) {
      const a = frame.landmarks[ankle];
      g.beginPath();
      g.moveTo(px(a.x), py(a.y) - height * 0.04);
      g.lineTo(px(a.x), py(a.y) + height * 0.02);
      g.stroke();
    }
    annotations.push("stride_markers");
  }

  // Phase label chip.
  const label = phase.toUpperCase();
  g.font = `bold ${Math.max(14, Math.round(height / 28))}px system-ui, sans-serif`;
  const pad = Math.round(height / 70) + 4;
  const textWidth = g.measureText(label).width;
  g.fillStyle = "rgba(15, 23, 42, 0.75)";
  g.fillRect(pad, pad, textWidth + pad * 2, pad * 2.4);
  g.fillStyle = "#f8fafc";
  g.fillText(label, pad * 2, pad + pad * 1.7);

  const blob = await canvas.convertToBlob({
    type: ctx.encoding.contentType,
    quality: ctx.encoding.quality,
  });
  return { phase, blob, contentType: ctx.encoding.contentType, annotations };
}

export function stillInfoFor(
  rendered: RenderedStill,
  path: string
): StillInfo {
  return {
    path,
    phase: rendered.phase,
    contentType: rendered.contentType,
    annotations: rendered.annotations,
  };
}

function mid(frame: KeypointFrame, a: number, b: number) {
  return {
    x: (frame.landmarks[a].x + frame.landmarks[b].x) / 2,
    y: (frame.landmarks[a].y + frame.landmarks[b].y) / 2,
  };
}

function drawCrosshair(
  g: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  color: string
) {
  const r = Math.max(8, width / 90);
  g.strokeStyle = color;
  g.lineWidth = Math.max(2, width / 400);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(x - r * 1.5, y);
  g.lineTo(x + r * 1.5, y);
  g.moveTo(x, y - r * 1.5);
  g.lineTo(x, y + r * 1.5);
  g.stroke();
}
