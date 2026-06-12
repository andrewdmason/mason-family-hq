"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeypointFrame } from "@/lib/swing/pipeline/pose";
import type { SwingEvents } from "@/lib/swing/types";
import { LAB_LM } from "./lab-types";

/** Bones to draw: shoulders/elbows/wrists/hips/knees/ankles. */
const BONES: [number, number][] = [
  [LAB_LM.leftShoulder, LAB_LM.rightShoulder],
  [LAB_LM.leftShoulder, LAB_LM.leftElbow],
  [LAB_LM.leftElbow, LAB_LM.leftWrist],
  [LAB_LM.rightShoulder, LAB_LM.rightElbow],
  [LAB_LM.rightElbow, LAB_LM.rightWrist],
  [LAB_LM.leftShoulder, LAB_LM.leftHip],
  [LAB_LM.rightShoulder, LAB_LM.rightHip],
  [LAB_LM.leftHip, LAB_LM.rightHip],
  [LAB_LM.leftHip, LAB_LM.leftKnee],
  [LAB_LM.leftKnee, LAB_LM.leftAnkle],
  [LAB_LM.rightHip, LAB_LM.rightKnee],
  [LAB_LM.rightKnee, LAB_LM.rightAnkle],
];

const JOINTS: number[] = [...new Set(BONES.flat())];
const CANVAS_WIDTH = 480;

/**
 * Frame-by-frame skeleton eyeball test: draws the dense keypoint series on a
 * neutral background so swing motion (and wrist/ankle dropouts) can be
 * inspected without the source video.
 */
export function KeypointScrubber({
  keypoints,
  events,
  aspectRatio,
}: {
  keypoints: KeypointFrame[];
  events: SwingEvents;
  /** Clip width/height — keeps normalized coordinates undistorted. */
  aspectRatio: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState(0);
  const frame = keypoints[Math.min(index, keypoints.length - 1)];

  const height = Math.round(
    CANVAS_WIDTH / (aspectRatio > 0 ? aspectRatio : 16 / 9)
  );

  const phaseAt = useMemo(() => {
    const entries = Object.entries(events)
      .filter((e): e is [string, number] => e[1] !== undefined)
      .sort((a, b) => a[1] - b[1]);
    return (timestampMs: number): string | null => {
      let current: string | null = null;
      for (const [phase, t] of entries) {
        if (timestampMs >= t) current = phase;
      }
      return current;
    };
  }, [events]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#1c1917"; // neutral dark — joints read regardless of theme
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const px = (i: number) => ({
      x: (frame.landmarks[i]?.x ?? 0) * canvas.width,
      y: (frame.landmarks[i]?.y ?? 0) * canvas.height,
      v: frame.landmarks[i]?.visibility ?? 0,
    });

    ctx.lineWidth = 2;
    for (const [a, b] of BONES) {
      const pa = px(a);
      const pb = px(b);
      const v = Math.min(pa.v, pb.v);
      ctx.strokeStyle = v >= 0.45 ? "#34d399" : "#f87171";
      ctx.globalAlpha = Math.max(0.25, v);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const i of JOINTS) {
      const p = px(i);
      const isWrist = i === LAB_LM.leftWrist || i === LAB_LM.rightWrist;
      ctx.fillStyle =
        p.v >= 0.45 ? (isWrist ? "#fbbf24" : "#e7e5e4") : "#f87171";
      ctx.beginPath();
      ctx.arc(p.x, p.y, isWrist ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [frame]);

  if (keypoints.length === 0 || !frame) return null;

  const phase = phaseAt(frame.timestampMs);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={height}
        className="w-full rounded-lg border"
      />
      <input
        type="range"
        min={0}
        max={keypoints.length - 1}
        value={Math.min(index, keypoints.length - 1)}
        onChange={(e) => setIndex(Number(e.target.value))}
        className="w-full accent-primary"
        aria-label="Scrub keypoint frames"
      />
      <p className="text-xs text-muted-foreground tabular-nums">
        Frame {Math.min(index, keypoints.length - 1) + 1}/{keypoints.length} ·{" "}
        {frame.timestampMs.toFixed(0)} ms
        {phase ? ` · ${phase}` : ""} · pose confidence{" "}
        {frame.poseConfidence.toFixed(2)}
        {frame.interpolated ? " · interpolated" : ""}
        <span className="ml-2 text-muted-foreground/70">
          (wrists amber; red = below 0.45 visibility)
        </span>
      </p>
    </div>
  );
}
