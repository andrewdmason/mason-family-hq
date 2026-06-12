// Per-swing biomechanics metrics from a conditioned keypoint series + detected
// phases. Everything here is honestly derivable from a single side-on 2D
// skeleton; deliberately ABSENT (outside 2D honesty / product identity):
// hip-shoulder separation in degrees, rotational velocities, anything
// bat-related. hip_shoulder_timing is a TIMING proxy (onset ordering), never
// presented as degrees of separation.
//
// Confidence grading: trunk-derived metrics (shoulders/hips) grade high;
// wrist/ankle-derived metrics grade by observed visibility through their
// measurement window — child-pose extremity tracking is the known weak spot.

import type { MetricConfidence, MetricKey, MetricValue, SwingMetrics } from "@/lib/swing/types";
import { LM, type KeypointFrame } from "./pose";
import type { PhaseDetection } from "./phases";
import { midpoint } from "./smoothing";

export function computeMetrics(
  frames: KeypointFrame[],
  detection: PhaseDetection
): SwingMetrics {
  const { events, heightNorm } = detection;
  const at = frameAt(frames);
  const stance = at(events.stance);
  const plant = at(events.plant);
  const launch = at(events.launch);
  const contact = at(events.contact);
  if (!stance || !contact) return {};

  const metrics: SwingMetrics = {};
  const set = (key: MetricKey, value: MetricValue | null) => {
    if (value !== null && Number.isFinite(value.value)) metrics[key] = value;
  };

  /* Head drift: nose travel stance→contact, in hitter heights. Trunk-adjacent
   * (nose tracks well) → high confidence unless visibility says otherwise. */
  set("head_drift", {
    value:
      Math.hypot(
        contact.landmarks[LM.nose].x - stance.landmarks[LM.nose].x,
        contact.landmarks[LM.nose].y - stance.landmarks[LM.nose].y
      ) / heightNorm,
    confidence: visibilityConfidence([stance, contact], [LM.nose]),
    unit: "norm",
  });

  /* Stride length: ankle separation at plant ÷ height. Ankle-derived. */
  if (plant) {
    set("stride_length_ratio", {
      value:
        Math.abs(
          plant.landmarks[LM.leftAnkle].x - plant.landmarks[LM.rightAnkle].x
        ) / heightNorm,
      confidence: visibilityConfidence([plant], [LM.leftAnkle, LM.rightAnkle]),
      unit: "ratio",
    });
  }

  /* Spine angle vs vertical at stance and contact; posture loss = delta.
   * Pure trunk → high confidence. */
  const spineStance = spineAngleDeg(stance);
  const spineContact = spineAngleDeg(contact);
  set("spine_angle_stance", {
    value: spineStance,
    confidence: "high",
    unit: "deg",
  });
  set("spine_angle_contact", {
    value: spineContact,
    confidence: "high",
    unit: "deg",
  });
  set("posture_loss", {
    value: Math.abs(spineContact - spineStance),
    confidence: "high",
    unit: "deg",
  });

  /* Front knee extension at contact (blocking). Knee/ankle-derived. */
  const kneeAngle = jointAngleDeg(
    contact,
    hipFor(detection.leadKnee),
    detection.leadKnee,
    detection.leadAnkle
  );
  set("front_knee_angle_contact", {
    value: kneeAngle,
    confidence: visibilityConfidence(
      [contact],
      [detection.leadKnee, detection.leadAnkle]
    ),
    unit: "deg",
  });

  /* Back elbow slot during launch: elbow height relative to the shoulder
   * line, in hitter heights. Positive = elbow above shoulders (flying). */
  if (launch) {
    const shoulderY = midpoint(
      launch.landmarks[LM.leftShoulder],
      launch.landmarks[LM.rightShoulder]
    ).y;
    set("back_elbow_slot", {
      value: (shoulderY - launch.landmarks[detection.rearElbow].y) / heightNorm,
      confidence: visibilityConfidence([launch], [detection.rearElbow]),
      unit: "norm",
    });
  }

  /* Tempo: phase durations. Timing metrics are the most robust 2D reads. */
  if (events.load !== undefined && events.plant !== undefined) {
    set("load_duration", {
      value: events.plant - events.load,
      confidence: "high",
      unit: "ms",
    });
  }
  if (events.plant !== undefined && events.launch !== undefined) {
    set("stride_duration", {
      value: events.launch - events.plant,
      confidence: "high",
      unit: "ms",
    });
  }
  if (events.launch !== undefined && events.contact !== undefined) {
    set("swing_duration", {
      value: events.contact - events.launch,
      confidence: "high",
      unit: "ms",
    });
  }

  /* Weight transfer proxy: hip-midpoint horizontal travel stance→contact in
   * the swing direction, ÷ stance ankle width. Trunk-derived. */
  const stanceWidth = Math.abs(
    stance.landmarks[LM.leftAnkle].x - stance.landmarks[LM.rightAnkle].x
  );
  if (stanceWidth > 1e-4) {
    const hipTravel =
      (midpoint(contact.landmarks[LM.leftHip], contact.landmarks[LM.rightHip]).x -
        midpoint(stance.landmarks[LM.leftHip], stance.landmarks[LM.rightHip]).x) *
      detection.swingDirection;
    set("weight_transfer", {
      value: hipTravel / stanceWidth,
      confidence: "high",
      unit: "ratio",
    });
  }

  /* Hip-vs-shoulder rotation onset timing proxy: when each segment's
   * x-width starts collapsing/expanding (foreshortening onset) approaching
   * launch. Positive = hips fired first (good); negative = shoulders first
   * (flying open). TIMING ONLY — never degrees. */
  const hipOnset = rotationOnsetMs(frames, LM.leftHip, LM.rightHip, events, heightNorm);
  const shoulderOnset = rotationOnsetMs(
    frames,
    LM.leftShoulder,
    LM.rightShoulder,
    events,
    heightNorm
  );
  if (hipOnset !== null && shoulderOnset !== null) {
    set("hip_shoulder_timing", {
      value: shoulderOnset - hipOnset,
      confidence: "medium",
      unit: "ms",
    });
  }

  return metrics;
}

/* --------------------------------------------------------------- helpers - */

function frameAt(frames: KeypointFrame[]) {
  return (timestampMs: number | undefined): KeypointFrame | null => {
    if (timestampMs === undefined) return null;
    let best: KeypointFrame | null = null;
    let bestDist = Infinity;
    for (const f of frames) {
      const d = Math.abs(f.timestampMs - timestampMs);
      if (d < bestDist) {
        bestDist = d;
        best = f;
      }
    }
    return best;
  };
}

/** Spine angle vs vertical, degrees: hip-mid → shoulder-mid lean. */
function spineAngleDeg(frame: KeypointFrame): number {
  const hips = midpoint(frame.landmarks[LM.leftHip], frame.landmarks[LM.rightHip]);
  const shoulders = midpoint(
    frame.landmarks[LM.leftShoulder],
    frame.landmarks[LM.rightShoulder]
  );
  return (
    (Math.atan2(Math.abs(shoulders.x - hips.x), Math.abs(hips.y - shoulders.y)) *
      180) /
    Math.PI
  );
}

/** Interior angle at joint b for segment a-b-c, degrees (180 = straight). */
function jointAngleDeg(
  frame: KeypointFrame,
  a: number,
  b: number,
  c: number
): number {
  const pa = frame.landmarks[a];
  const pb = frame.landmarks[b];
  const pc = frame.landmarks[c];
  const v1 = { x: pa.x - pb.x, y: pa.y - pb.y };
  const v2 = { x: pc.x - pb.x, y: pc.y - pb.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (mag < 1e-9) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function hipFor(kneeIndex: number): number {
  return kneeIndex === LM.leftKnee ? LM.leftHip : LM.rightHip;
}

/**
 * Rotation onset: first time after plant-ish where the segment's projected
 * x-width changes faster than a threshold (foreshortening = turning).
 */
function rotationOnsetMs(
  frames: KeypointFrame[],
  leftIdx: number,
  rightIdx: number,
  events: { plant?: number; contact?: number },
  heightNorm: number
): number | null {
  if (events.plant === undefined || events.contact === undefined) return null;
  const widths = frames.map((f) =>
    Math.abs(f.landmarks[leftIdx].x - f.landmarks[rightIdx].x)
  );
  for (let i = 1; i < frames.length; i++) {
    const t = frames[i].timestampMs;
    if (t < events.plant - 100 || t > events.contact) continue;
    const dt = (frames[i].timestampMs - frames[i - 1].timestampMs) / 1000;
    if (dt <= 0) continue;
    const rate = Math.abs(widths[i] - widths[i - 1]) / heightNorm / dt;
    if (rate > 0.5) return t;
  }
  return null;
}

function visibilityConfidence(
  frames: KeypointFrame[],
  landmarkIndices: number[]
): MetricConfidence {
  let min = 1;
  for (const f of frames) {
    for (const i of landmarkIndices) {
      min = Math.min(min, f.landmarks[i]?.visibility ?? 0);
    }
    if (f.interpolated) min = Math.min(min, 0.55);
  }
  if (min >= 0.7) return "high";
  if (min >= 0.5) return "medium";
  return "low";
}
