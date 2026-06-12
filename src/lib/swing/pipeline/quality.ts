// Per-clip quality gates with coach-readable rejection reasons. The reasons
// double as filming education — every rejection tells the coach what to do
// differently ("film from the side", "get closer") rather than just failing.
//
// Thresholds live in QUALITY_TUNING (U1 spike calibrates).

import type { KeypointFrame } from "./pose";
import { LM } from "./pose";
import { hitterHeight } from "./smoothing";
import type { SwingWindow } from "./phases";

export const QUALITY_TUNING = {
  /** Hitter height as a fraction of frame height below which pose is mush. */
  minSubjectHeightFraction: 0.18,
  /** Mean core-landmark visibility a frame must clear to count as "good". */
  minFrameConfidence: 0.5,
  /** Max fraction of low-confidence frames tolerated in the swing window. */
  maxLowConfidenceFraction: 0.3,
  /**
   * Side-on check: shoulder x-separation ÷ hitter height at stance. Side-on
   * foreshortens the shoulders (small value); front-on spreads them. Above
   * this ratio we call the clip off-angle.
   */
  maxShoulderWidthRatio: 0.16,
  /** Wrist visibility through launch→contact (the event-detection precondition). */
  minWristVisibility: 0.45,
  maxLowWristFraction: 0.4,
} as const;

export type RejectionCode =
  | "no_swing_detected"
  | "subject_too_small"
  | "low_pose_confidence"
  | "off_angle"
  | "low_wrist_confidence"
  | "implausible_swing";

export const REJECTION_MESSAGES: Record<RejectionCode, string> = {
  no_swing_detected:
    "No swing found in this clip. Make sure the clip contains one full swing, start to finish.",
  subject_too_small:
    "The hitter is too small in the frame for reliable analysis. Move the camera closer — the player should fill most of the frame height.",
  low_pose_confidence:
    "Couldn't track the hitter's body reliably. Check that the full body is visible, nothing blocks the view, and only one person is in the frame.",
  off_angle:
    "This looks like it was filmed from the front. Film from the side (facing the hitter's chest), level with the hitter.",
  low_wrist_confidence:
    "Couldn't track the hands through the swing. Try filming from the open side with the whole body in frame.",
  implausible_swing:
    "Couldn't read this swing reliably — the motion didn't look like a single complete swing. Re-film with one swing per clip.",
};

export interface QualityVerdict {
  ok: boolean;
  code?: RejectionCode;
  message?: string;
  /** Non-fatal flags surfaced to the coach (e.g., extra swings in the clip). */
  warnings: string[];
}

/** Gates that run on the coarse pass, before any dense work is spent. */
export function preGate(
  frames: KeypointFrame[],
  bursts: SwingWindow[]
): QualityVerdict {
  const warnings: string[] = [];

  if (frames.length === 0 || bursts.length === 0) {
    return reject("no_swing_detected");
  }
  if (bursts.length > 1) {
    warnings.push(
      `Found ${bursts.length} swings in this clip — using the most prominent one. One swing per clip reads best.`
    );
  }

  const stanceFrames = frames.slice(0, Math.max(3, Math.floor(frames.length / 5)));
  const height = median(stanceFrames.map(hitterHeight));
  if (height < QUALITY_TUNING.minSubjectHeightFraction) {
    return reject("subject_too_small", warnings);
  }

  // Off-angle: shoulder spread relative to hitter height at stance.
  const shoulderRatio = median(
    stanceFrames.map(
      (f) =>
        Math.abs(f.landmarks[LM.leftShoulder].x - f.landmarks[LM.rightShoulder].x) /
        Math.max(hitterHeight(f), 1e-6)
    )
  );
  if (shoulderRatio > QUALITY_TUNING.maxShoulderWidthRatio) {
    return reject("off_angle", warnings);
  }

  return { ok: true, warnings };
}

/** Gates that run on the dense series around the chosen swing window. */
export function denseGate(
  frames: KeypointFrame[],
  launchMs: number | undefined,
  contactMs: number | undefined
): QualityVerdict {
  const warnings: string[] = [];

  const lowConfidence =
    frames.filter((f) => f.poseConfidence < QUALITY_TUNING.minFrameConfidence)
      .length / Math.max(frames.length, 1);
  if (lowConfidence > QUALITY_TUNING.maxLowConfidenceFraction) {
    return reject("low_pose_confidence", warnings);
  }

  // Wrist trackability through the launch→contact window — the precondition
  // for trusting contact-anchored events and metrics (plan: U1/U5 gate).
  if (launchMs !== undefined && contactMs !== undefined) {
    const windowFrames = frames.filter(
      (f) => f.timestampMs >= launchMs && f.timestampMs <= contactMs
    );
    if (windowFrames.length > 0) {
      const lowWrist =
        windowFrames.filter(
          (f) =>
            Math.max(
              f.landmarks[LM.leftWrist].visibility,
              f.landmarks[LM.rightWrist].visibility
            ) < QUALITY_TUNING.minWristVisibility
        ).length / windowFrames.length;
      if (lowWrist > QUALITY_TUNING.maxLowWristFraction) {
        return reject("low_wrist_confidence", warnings);
      }
    }
  }

  return { ok: true, warnings };
}

function reject(code: RejectionCode, warnings: string[] = []): QualityVerdict {
  return { ok: false, code, message: REJECTION_MESSAGES[code], warnings };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
